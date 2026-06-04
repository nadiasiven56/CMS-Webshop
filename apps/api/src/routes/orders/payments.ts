/**
 * POST /api/orders/:id/payments — betaling registreren.
 *
 * Body: { provider?, amount, status?, reference?, markPaid? }
 * Effect:
 *   - insert order_payments-row (paid_at gezet bij status='paid')
 *   - bij status='paid': herbereken financial_status:
 *       som(paid payments) >= grand_total → 'paid', anders 'partially_refunded'?
 *       (V1: >=grand_total → 'paid', >0 → 'partially' niet van toepassing op
 *        betalingen; we zetten 'paid' bij volledige dekking)
 *   - bij markPaid (default true bij status='paid' en order nog pending) →
 *     order.status='paid'
 *
 * Alles in 1 transactie + audit ('update'/'pay' op 'order').
 *
 * 201 { payment, order } · 400 · 404 not_found
 *
 * GET /api/orders/:id/payments — lijst.
 */
import type { Context } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { orders } from '../../db/schema/orders.js';
import { orderItems } from '../../db/schema/order-items.js';
import { orderPayments } from '../../db/schema/order-payments.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { postOrderRevenue } from '../../domain/finance/ledger-posting.js';
import { money, add, ZERO, gt, lt } from '@webshop-crm/shared/types/money';
import { isUuid } from '../products/_validate.js';
import { PaymentCreateSchema } from './_schemas.js';
import { toOrderCore, toOrderPaymentDto } from './_serialize.js';
import { fireOrderPaid } from '../../domain/orchestration/order-events.js';

export async function listPayments(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [order] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) return c.json({ error: 'not_found' }, 404);

  const rows = await db
    .select()
    .from(orderPayments)
    .where(eq(orderPayments.orderId, id))
    .orderBy(desc(orderPayments.createdAt));
  return c.json({ payments: rows.map(toOrderPaymentDto) });
}

export async function createPayment(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const body = await c.req.json().catch(() => null);
  const parsed = PaymentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) return c.json({ error: 'not_found' }, 404);

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [payment] = await tx
      .insert(orderPayments)
      .values({
        orderId: id,
        provider: input.provider,
        amount: money(input.amount),
        status: input.status,
        reference: input.reference ?? null,
        paidAt: input.status === 'paid' ? new Date() : null,
      })
      .returning();
    if (!payment) throw new Error('payment insert returned no row');

    // Bereken financial_status uit alle 'paid' payments (incl. de nieuwe).
    const allRows = await tx
      .select({ amount: orderPayments.amount, status: orderPayments.status })
      .from(orderPayments)
      .where(eq(orderPayments.orderId, id));
    let paidSum = ZERO;
    for (const r of allRows) {
      if (r.status === 'paid' && r.amount) paidSum = add(paidSum, money(r.amount));
    }

    const grand = order.grandTotal ? money(order.grandTotal) : ZERO;
    let financialStatus = order.financialStatus;
    if (!lt(paidSum, grand) && gt(paidSum, ZERO)) {
      financialStatus = 'paid';
    } else if (gt(paidSum, ZERO)) {
      financialStatus = 'pending'; // deels betaald, nog niet volledig
    }

    const promoteOrder =
      (input.markPaid ?? (input.status === 'paid' && financialStatus === 'paid')) &&
      order.status === 'pending';

    const [updatedOrder] = await tx
      .update(orders)
      .set({
        financialStatus,
        ...(promoteOrder ? { status: 'paid' } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id))
      .returning();
    if (!updatedOrder) throw new Error('order update returned no row');

    // Ledger-automation: zodra de order financieel 'paid' is, boek de omzet.
    // postOrderRevenue is idempotent (guard op bestaande revenue-regel), dus
    // herhaalde betalingen / status-replays boeken niet dubbel.
    let revenuePosted = 0;
    if (updatedOrder.financialStatus === 'paid') {
      const items = await tx
        .select({
          quantity: orderItems.quantity,
          costPrice: orderItems.costPrice,
          taxRate: orderItems.taxRate,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, id));
      revenuePosted = await postOrderRevenue(tx, updatedOrder, items);
    }

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'order',
      entityId: id,
      before: { financialStatus: order.financialStatus, status: order.status },
      after: {
        financialStatus: updatedOrder.financialStatus,
        status: updatedOrder.status,
        paymentId: payment.id,
        amount: payment.amount,
        provider: payment.provider,
        ledgerEntriesPosted: revenuePosted,
      },
      ip,
    });

    return { payment, order: updatedOrder };
  });

  // ── Side-effects (koppel-klaar; fire-and-forget, NA de tx) ──
  // Alleen op de TRANSITIE naar financieel 'paid' (niet bij elke betaalrij),
  // zodat order.paid + bevestigingsmail exact één keer per order vuren.
  if (order.financialStatus !== 'paid' && result.order.financialStatus === 'paid') {
    void fireOrderPaid(result.order);
  }

  return c.json(
    {
      payment: toOrderPaymentDto(result.payment),
      order: toOrderCore(result.order),
    },
    201,
  );
}
