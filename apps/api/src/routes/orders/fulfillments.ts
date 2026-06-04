/**
 * POST /api/orders/:id/fulfillments — verzending aanmaken.
 *
 * Body: { locationId?, carrier?, trackingCode?, trackingUrl?, status?, markShipped? }
 * Effect:
 *   - insert order_fulfillments-row (shipped_at gezet bij status='shipped'/'delivered')
 *   - zet order.fulfillment_status op de fulfillment-status
 *   - bij status 'shipped' en order nog niet shipped/delivered → order.status='shipped'
 *     (tenzij markShipped expliciet false)
 *
 * Alles in 1 transactie + audit ('ship' op 'order').
 *
 * 201 { fulfillment, order } · 400 · 404 not_found
 *
 * GET /api/orders/:id/fulfillments — lijst.
 */
import type { Context } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { orders } from '../../db/schema/orders.js';
import { orderFulfillments } from '../../db/schema/order-fulfillments.js';
import { locations } from '../../db/schema/locations.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { isUuid } from '../products/_validate.js';
import { FulfillmentCreateSchema } from './_schemas.js';
import { toOrderCore, toOrderFulfillmentDto } from './_serialize.js';
import { fireOrderFulfilled } from '../../domain/orchestration/order-events.js';

export async function listFulfillments(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [order] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) return c.json({ error: 'not_found' }, 404);

  const rows = await db
    .select()
    .from(orderFulfillments)
    .where(eq(orderFulfillments.orderId, id))
    .orderBy(desc(orderFulfillments.createdAt));
  return c.json({ fulfillments: rows.map(toOrderFulfillmentDto) });
}

export async function createFulfillment(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const body = await c.req.json().catch(() => null);
  const parsed = FulfillmentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) return c.json({ error: 'not_found' }, 404);

  if (input.locationId) {
    const [loc] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.id, input.locationId))
      .limit(1);
    if (!loc) return c.json({ error: 'location_not_found' }, 404);
  }

  const isShippedLike = input.status === 'shipped' || input.status === 'delivered';
  const markShipped = input.markShipped ?? isShippedLike;
  const promoteOrder =
    markShipped && isShippedLike && order.status !== 'shipped' && order.status !== 'delivered'
      && order.status !== 'cancelled' && order.status !== 'refunded';

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [fulfillment] = await tx
      .insert(orderFulfillments)
      .values({
        orderId: id,
        locationId: input.locationId ?? null,
        status: input.status,
        carrier: input.carrier ?? null,
        trackingCode: input.trackingCode ?? null,
        trackingUrl: input.trackingUrl ?? null,
        shippedAt: isShippedLike ? new Date() : null,
      })
      .returning();
    if (!fulfillment) throw new Error('fulfillment insert returned no row');

    const [updatedOrder] = await tx
      .update(orders)
      .set({
        fulfillmentStatus: input.status,
        ...(promoteOrder ? { status: 'shipped' } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id))
      .returning();
    if (!updatedOrder) throw new Error('order update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'ship',
      entityType: 'order',
      entityId: id,
      before: { fulfillmentStatus: order.fulfillmentStatus, status: order.status },
      after: {
        fulfillmentStatus: updatedOrder.fulfillmentStatus,
        status: updatedOrder.status,
        fulfillmentId: fulfillment.id,
        carrier: fulfillment.carrier,
        trackingCode: fulfillment.trackingCode,
      },
      ip,
    });

    return { fulfillment, order: updatedOrder };
  });

  // ── Side-effects (koppel-klaar; fire-and-forget, NA de tx) ──
  // Een echte verzending (shipped/delivered) triggert de verzendmail, het
  // `order.fulfilled`-webhook én een review-uitnodiging. Pure status-bumps
  // (bv. 'pending'/'processing') vuren niets — alleen de daadwerkelijke shipment.
  if (isShippedLike) {
    void fireOrderFulfilled(result.order, {
      trackingUrl: result.fulfillment.trackingUrl,
      trackingCode: result.fulfillment.trackingCode,
      carrier: result.fulfillment.carrier,
    });
  }

  return c.json(
    {
      fulfillment: toOrderFulfillmentDto(result.fulfillment),
      order: toOrderCore(result.order),
    },
    201,
  );
}
