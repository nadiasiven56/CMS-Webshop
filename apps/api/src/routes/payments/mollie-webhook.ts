/**
 * Mollie webhook handler (Wave-H A4).
 *
 *   POST /api/payments/mollie/webhook   (PUBLIC, x-www-form-urlencoded, field `id`)
 *
 * Flow:
 *   1. Parse `id` from the form body. Missing → 200 (ack, nothing to do — Mollie
 *      retries on non-2xx, so we only non-2xx for transient server errors).
 *   2. Find the linked order via the pending Mollie payment row
 *      (order_payments.reference = id AND provider = 'mollie').
 *   3. Reconstruct the shop's PaymentProvider (decrypted key) and fetch the
 *      AUTHORITATIVE status from Mollie (GET /v2/payments/{id}) — never trust the
 *      webhook body. We also read metadata.orderId as a cross-check / fallback.
 *   4. 'paid'  → mark order + payment paid + postOrderRevenue (idempotent).
 *      'failed'|'expired'|'canceled' → mark payment + order financial_status.
 *      anything else (open/pending/authorized) → leave as-is.
 *   5. Idempotent: a second delivery of the same id finds the order already
 *      paid (or the ledger already posted) and is a no-op.
 *
 * Guard: nothing fires to Mollie without a key — if the shop is no longer
 * configured we ack 200 and skip (the provider would be null).
 */
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { orders } from '../../db/schema/orders.js';
import { orderItems } from '../../db/schema/order-items.js';
import { orderPayments } from '../../db/schema/order-payments.js';
import { shops } from '../../db/schema/shops.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { postOrderRevenue } from '../../domain/finance/ledger-posting.js';
import { getPaymentProvider } from '../../domain/payments/index.js';
import { MollieProvider } from '../../domain/payments/mollie.js';
import { PaymentProviderError } from '../../domain/payments/types.js';
import { fireOrderPaid } from '../../domain/orchestration/order-events.js';

/**
 * Parse the Mollie webhook body. Mollie sends `application/x-www-form-urlencoded`
 * with a single `id` field. We read the raw text and URL-decode defensively so a
 * missing Content-Type header can't break parsing.
 */
async function readPaymentId(c: Context): Promise<string | null> {
  // Hono's parseBody handles urlencoded + multipart.
  try {
    const body = await c.req.parseBody();
    const id = body['id'];
    if (typeof id === 'string' && id.length > 0) return id;
  } catch {
    // fall through to raw parsing
  }
  try {
    const raw = await c.req.text();
    if (raw) {
      const params = new URLSearchParams(raw);
      const id = params.get('id');
      if (id) return id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function mollieWebhook(c: Context): Promise<Response> {
  const paymentId = await readPaymentId(c);
  if (!paymentId) {
    // Nothing actionable — ack so Mollie doesn't retry forever.
    return c.json({ ok: true, skipped: 'no_id' }, 200);
  }

  // 1) Locate the pending Mollie payment row → order link.
  const [paymentRow] = await db
    .select()
    .from(orderPayments)
    .where(
      and(
        eq(orderPayments.reference, paymentId),
        eq(orderPayments.provider, 'mollie'),
      ),
    )
    .limit(1);

  if (!paymentRow) {
    // Unknown id (or not ours). Ack — could be a replay before our row existed,
    // but we never throw on an unknown id.
    logger.warn({ paymentId }, 'mollie webhook: no matching payment row');
    return c.json({ ok: true, skipped: 'unknown_payment' }, 200);
  }

  // 2) Load order + shop (we need the shop's key to verify status).
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, paymentRow.orderId))
    .limit(1);
  if (!order) {
    logger.warn({ paymentId, orderId: paymentRow.orderId }, 'mollie webhook: order missing');
    return c.json({ ok: true, skipped: 'order_missing' }, 200);
  }

  // Idempotency fast-path: already paid → nothing to do.
  if (order.financialStatus === 'paid' && paymentRow.status === 'paid') {
    return c.json({ ok: true, alreadyPaid: true }, 200);
  }

  const [shop] = await db.select().from(shops).where(eq(shops.id, order.shopId)).limit(1);
  if (!shop) {
    return c.json({ ok: true, skipped: 'shop_missing' }, 200);
  }

  const provider = getPaymentProvider(shop);
  if (!provider || !(provider instanceof MollieProvider)) {
    // Shop no longer configured for Mollie → can't verify; ack and skip.
    logger.warn({ paymentId, shopId: shop.id }, 'mollie webhook: provider not configured');
    return c.json({ ok: true, skipped: 'provider_not_configured' }, 200);
  }

  // 3) Authoritative status straight from Mollie (never trust the body).
  let status: string;
  let metaOrderId: string | null = null;
  try {
    const payment = await provider.getPayment(paymentId);
    status = payment.status;
    metaOrderId = payment.orderId;
  } catch (err) {
    if (err instanceof PaymentProviderError && err.status && err.status >= 400 && err.status < 500) {
      // 4xx (e.g. unknown payment / bad key) → not transient; ack to stop retries.
      logger.warn({ paymentId, status: err.status }, 'mollie webhook: 4xx on verify');
      return c.json({ ok: true, skipped: 'verify_4xx' }, 200);
    }
    // Transient (5xx / network) → 503 so Mollie retries later.
    logger.error({ paymentId, err }, 'mollie webhook: verify failed (transient)');
    return c.json({ error: 'verify_failed' }, 503);
  }

  // Cross-check metadata.orderId when present (defence against id-reuse).
  if (metaOrderId && metaOrderId !== order.id) {
    logger.warn(
      { paymentId, metaOrderId, orderId: order.id },
      'mollie webhook: metadata orderId mismatch — ignoring',
    );
    return c.json({ ok: true, skipped: 'order_mismatch' }, 200);
  }

  // 4) Apply the authoritative status (idempotent transaction).
  if (status === 'paid') {
    await markOrderPaid(order.id, paymentRow.id, c.req.header('x-forwarded-for') ?? null);
    // Transactionele bevestiging + order.paid-webhook. De storefront-checkout
    // slaat dit in de PSP-flow bewust over ('later via de payments-webhook') —
    // hier sluiten we de e-mail-/webhook-keten voor élke echte PSP-betaling.
    void fireOrderPaid({ ...order, status: 'paid', financialStatus: 'paid' });
    logger.info({ paymentId, orderId: order.id }, 'mollie webhook: order marked paid + ledger posted');
    return c.json({ ok: true, status: 'paid' }, 200);
  }

  if (status === 'failed' || status === 'expired' || status === 'canceled') {
    await markOrderUnpaid(order.id, paymentRow.id, status);
    logger.info({ paymentId, orderId: order.id, status }, 'mollie webhook: order marked unpaid');
    return c.json({ ok: true, status }, 200);
  }

  // open / pending / authorized / unknown → wait for the next webhook.
  return c.json({ ok: true, status }, 200);
}

/**
 * Mark the order + payment paid and post the revenue ledger. Idempotent on every
 * level: a re-entry sees financial_status='paid' and bails before re-posting; the
 * ledger itself is idempotent (postOrderRevenue skips when a revenue row exists).
 */
async function markOrderPaid(
  orderId: string,
  paymentRowId: string,
  ip: string | null,
): Promise<void> {
  await runInTransactionWithAudit(async (tx, audit) => {
    // Re-read inside the tx to avoid a double-apply race between deliveries.
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return;
    if (order.financialStatus === 'paid') return; // already applied → no-op

    await tx
      .update(orders)
      .set({ status: 'paid', financialStatus: 'paid', updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    await tx
      .update(orderPayments)
      .set({ status: 'paid', paidAt: new Date() })
      .where(eq(orderPayments.id, paymentRowId));

    const items = await tx
      .select({
        quantity: orderItems.quantity,
        costPrice: orderItems.costPrice,
        taxRate: orderItems.taxRate,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    // Idempotent — skips if a revenue row already exists for this order.
    await postOrderRevenue(tx, order, items);

    audit.set({
      actor: { type: 'webhook', id: null },
      action: 'update',
      entityType: 'order',
      entityId: orderId,
      before: { financialStatus: order.financialStatus },
      after: { financialStatus: 'paid', source: 'mollie_webhook' },
      ip,
    });
  });
}

/** Mark a Mollie payment failed/expired/canceled. Leaves the order un-fulfilled. */
async function markOrderUnpaid(
  orderId: string,
  paymentRowId: string,
  status: 'failed' | 'expired' | 'canceled',
): Promise<void> {
  await runInTransactionWithAudit(async (tx, audit) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return;
    if (order.financialStatus === 'paid') return; // a later 'paid' won — don't downgrade

    // Map terminal-fail statuses onto our order vocabulary.
    const orderStatus = status === 'canceled' ? 'cancelled' : order.status;
    await tx
      .update(orders)
      .set({ status: orderStatus, updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    await tx
      .update(orderPayments)
      .set({ status: 'failed' })
      .where(eq(orderPayments.id, paymentRowId));

    audit.set({
      actor: { type: 'webhook', id: null },
      action: 'update',
      entityType: 'order',
      entityId: orderId,
      before: { status: order.status },
      after: { paymentStatus: status, source: 'mollie_webhook' },
      ip: null,
    });
  });
}
