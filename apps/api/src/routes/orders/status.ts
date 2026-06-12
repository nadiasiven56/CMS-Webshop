/**
 * PATCH /api/orders/:id/status — status-transitie.
 *
 * Geldige transities (zie domain/orders/status-machine.ts):
 *   pending → paid → fulfilled → shipped → delivered, + cancelled/refunded.
 * Afgeleide financial/fulfillment-status wordt mee-gezet. Alles via
 * `runInTransactionWithAudit` (action 'update', entityType 'order').
 *
 * 200 { order } · 400 invalid · 404 not_found · 409 invalid_transition
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { orders } from '../../db/schema/orders.js';
import { orderItems } from '../../db/schema/order-items.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { postOrderRevenue, reverseOrderLedger } from '../../domain/finance/ledger-posting.js';
import {
  isValidTransition,
  allowedNextStatuses,
  derivedStatuses,
  isOrderStatus,
  type OrderStatus,
} from '../../domain/orders/status-machine.js';
import { canAccessShop } from '../../lib/access.js';
import { isUuid } from '../products/_validate.js';
import { StatusUpdateSchema } from './_schemas.js';
import { toOrderCore } from './_serialize.js';
import {
  fireOrderPaid,
  fireOrderFulfilled,
  fireOrderCancelled,
} from '../../domain/orchestration/order-events.js';

export async function updateOrderStatus(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const body = await c.req.json().catch(() => null);
  const parsed = StatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { status: to, note } = parsed.data;

  const [existing] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!existing) {
    return c.json({ error: 'not_found' }, 404);
  }
  // Multi-user: shop niet toegankelijk → zelfde 404 (geen existence-leak).
  if (!(await canAccessShop(user, existing.shopId))) {
    return c.json({ error: 'not_found' }, 404);
  }

  const from = existing.status;
  if (!isOrderStatus(from)) {
    // Onbekende huidige status (data-corruptie) — laat alleen forceren via expliciete fout
    return c.json({ error: 'unknown_current_status', current: from }, 409);
  }
  if (!isValidTransition(from as OrderStatus, to)) {
    return c.json(
      {
        error: 'invalid_transition',
        from,
        to,
        allowed: allowedNextStatuses(from as OrderStatus),
      },
      409,
    );
  }

  const derived = derivedStatuses(to);

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(orders)
      .set({
        status: to,
        ...(derived.financialStatus ? { financialStatus: derived.financialStatus } : {}),
        ...(derived.fulfillmentStatus ? { fulfillmentStatus: derived.fulfillmentStatus } : {}),
        ...(note !== undefined ? { note } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id))
      .returning();
    if (!row) throw new Error('order update returned no row');

    // ── Grootboek synchroniseren met de financiële transitie ──
    // De status-route is een ALTERNATIEF paid/refunded/cancelled-pad. Houd het
    // grootboek in lijn met de getoonde status (anders divergeren source=orders
    // en source=ledger).
    if (derived.financialStatus === 'paid' && existing.financialStatus !== 'paid') {
      // Boek de omzet (idempotent: doet niets als de payments-route al boekte).
      const items = await tx
        .select({
          quantity: orderItems.quantity,
          costPrice: orderItems.costPrice,
          taxRate: orderItems.taxRate,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, id));
      await postOrderRevenue(tx, row, items);
    } else if (
      (to === 'refunded' || to === 'cancelled') &&
      existing.financialStatus === 'paid'
    ) {
      // Eerder geboekte omzet terugdraaien bij een status-only refund/annulering
      // (zonder bijbehorende return). Netto P&L-effect wordt 0.
      await reverseOrderLedger(tx, id);
    }

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'order',
      entityId: id,
      before: { status: from, financialStatus: existing.financialStatus, fulfillmentStatus: existing.fulfillmentStatus },
      after: { status: row.status, financialStatus: row.financialStatus, fulfillmentStatus: row.fulfillmentStatus },
      ip,
    });

    return row;
  });

  // ── Side-effects (koppel-klaar; fire-and-forget, NA de tx) ──
  // De status-route is een ALTERNATIEF pad naar paid/shipped/cancelled (los van
  // de payments-/fulfillments-routes). Een order doorloopt elke transitie maar
  // één keer, dus hier vuren op de transitie dubbelt niet met de andere routes.
  if (from !== to) {
    if (to === 'paid') {
      void fireOrderPaid(updated);
    } else if (to === 'fulfilled' || to === 'shipped' || to === 'delivered') {
      void fireOrderFulfilled(updated, {
        trackingUrl: null,
        trackingCode: null,
        carrier: null,
      });
    } else if (to === 'cancelled') {
      void fireOrderCancelled(updated);
    }
  }

  return c.json({ order: toOrderCore(updated) });
}
