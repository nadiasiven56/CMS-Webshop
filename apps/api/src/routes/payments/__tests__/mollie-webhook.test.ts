/**
 * Mollie-webhook-handler E2E — ECHTE Postgres (:7432) + GEMOCKTE provider.
 *
 * We mocken alleen `getPaymentProvider` (zodat er nooit een echte HTTP-call naar
 * Mollie gaat) en spyën op `MollieProvider.prototype.getPayment` om de
 * autoritatieve status te bepalen. De DB-mutaties (order/payment/ledger) draaien
 * tegen de echte database.
 *
 * Dekt:
 *   - status 'paid' → order + payment 'paid', ledger 1x geboekt; een DUBBELE
 *     delivery boekt NIET nog eens (idempotent) en gooit geen exception.
 *   - status 'failed'/'expired'/'canceled' → payment 'failed' zonder een
 *     al-betaalde order te downgraden.
 *   - metadata.orderId-mismatch → skip (geen mutatie).
 *   - 4xx op verify → 200 ack (geen retry).
 *   - 5xx op verify → 503 (Mollie mag retryen).
 *   - onbekende payment-id → 200 ack.
 *
 * Uniek per run + cleanup in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { db, closeDb } from '../../../lib/db.js';
import { shops } from '../../../db/schema/shops.js';
import { orders } from '../../../db/schema/orders.js';
import { orderItems } from '../../../db/schema/order-items.js';
import { orderPayments } from '../../../db/schema/order-payments.js';
import { ledgerEntries } from '../../../db/schema/ledger-entries.js';
import { MollieProvider } from '../../../domain/payments/mollie.js';
import { PaymentProviderError, type PaymentStatus } from '../../../domain/payments/types.js';

// ─── Mock de provider-factory: altijd een echte MollieProvider-instantie ──
//   `instanceof MollieProvider` in de handler moet kloppen, dus we geven een
//   échte instantie terug en spyën los op getPayment per test.
vi.mock('../../../domain/payments/index.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../domain/payments/index.js')>();
  return {
    ...orig,
    getPaymentProvider: () => new MollieProvider('test_dummy_key_for_webhook'),
  };
});

// fireOrderPaid is fire-and-forget (mailt/dispatcht); stub het zodat de test geen
// netwerk raakt.
vi.mock('../../../domain/orchestration/order-events.js', () => ({
  fireOrderPaid: vi.fn(),
  fireOrderCreated: vi.fn(),
}));

const { mollieWebhook } = await import('../mollie-webhook.js');

const RUN = Date.now().toString(36);
const SHOP_SLUG = `mw-test-${RUN}`;

let shopId: string;
const orderIds: string[] = [];

function app() {
  const a = new Hono();
  a.post('/api/payments/mollie/webhook', mollieWebhook);
  return a;
}

/** POST de webhook met een x-www-form-urlencoded `id`-veld (zoals Mollie). */
function fireWebhook(paymentId: string) {
  return app().request('/api/payments/mollie/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id: paymentId }).toString(),
  });
}

/** Seed een order (pending_payment) + een pending Mollie-payment-row. */
async function seedOrder(opts: {
  orderNumber: string;
  paymentReference: string;
  orderStatus?: string;
  financialStatus?: string;
  paymentStatus?: string;
}): Promise<{ orderId: string; paymentRowId: string }> {
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      orderNumber: opts.orderNumber,
      status: opts.orderStatus ?? 'pending',
      financialStatus: opts.financialStatus ?? 'pending_payment',
      currency: 'EUR',
      subtotal: '100.0000',
      taxTotal: '21.0000',
      grandTotal: '121.0000',
      placedAt: new Date(),
    })
    .returning();
  orderIds.push(order!.id);

  await db.insert(orderItems).values({
    orderId: order!.id,
    quantity: 2,
    unitPrice: '50.0000',
    taxRate: '21.00',
    taxAmount: '21.0000',
    costPrice: '20.0000',
    lineTotal: '121.0000',
  });

  const [payment] = await db
    .insert(orderPayments)
    .values({
      orderId: order!.id,
      provider: 'mollie',
      amount: '121.0000',
      status: opts.paymentStatus ?? 'pending',
      reference: opts.paymentReference,
    })
    .returning();

  return { orderId: order!.id, paymentRowId: payment!.id };
}

/** Spy op getPayment → vaste (status, orderId). */
function mockGetPayment(status: PaymentStatus, orderId: string | null) {
  return vi.spyOn(MollieProvider.prototype, 'getPayment').mockResolvedValue({
    status,
    orderId,
    raw: {},
  });
}

beforeAll(async () => {
  const [shop] = await db
    .insert(shops)
    .values({
      slug: SHOP_SLUG,
      name: 'Mollie Webhook Shop',
      status: 'active',
      currency: 'EUR',
      paymentProvider: 'mollie',
    })
    .returning();
  shopId = shop!.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  try {
    if (orderIds.length) {
      await db.delete(ledgerEntries).where(inArray(ledgerEntries.orderId, orderIds));
      await db.delete(orders).where(inArray(orders.id, orderIds)); // items/payments cascade
    }
    if (shopId) await db.delete(shops).where(eq(shops.id, shopId));
  } finally {
    await closeDb();
  }
});

describe('mollie webhook — paid', () => {
  it("status 'paid' markeert order+payment paid en boekt de ledger 1x; dubbele delivery is idempotent", async () => {
    const ref = `tr_paid_${RUN}`;
    const { orderId, paymentRowId } = await seedOrder({
      orderNumber: `MW-PAID-${RUN}`,
      paymentReference: ref,
    });
    const spy = mockGetPayment('paid', orderId);

    const r1 = await fireWebhook(ref);
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as any).status).toBe('paid');

    const [order1] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order1!.financialStatus).toBe('paid');
    expect(order1!.status).toBe('paid');
    const [pay1] = await db.select().from(orderPayments).where(eq(orderPayments.id, paymentRowId));
    expect(pay1!.status).toBe('paid');
    expect(pay1!.paidAt).not.toBeNull();

    const ledger1 = await db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId));
    const revenueRows1 = ledger1.filter((e) => e.account === 'revenue');
    expect(revenueRows1).toHaveLength(1);
    const count1 = ledger1.length;

    // Tweede (dubbele) delivery → geen exception, geen tweede revenue-rij.
    const r2 = await fireWebhook(ref);
    expect(r2.status).toBe(200);

    const ledger2 = await db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId));
    expect(ledger2.filter((e) => e.account === 'revenue')).toHaveLength(1);
    expect(ledger2.length).toBe(count1); // exact dezelfde set — niets dubbel geboekt

    spy.mockRestore();
  });
});

describe('mollie webhook — failed/expired/canceled', () => {
  it("status 'failed' zet de payment op failed zonder de order te betalen", async () => {
    const ref = `tr_failed_${RUN}`;
    const { orderId, paymentRowId } = await seedOrder({
      orderNumber: `MW-FAIL-${RUN}`,
      paymentReference: ref,
    });
    const spy = mockGetPayment('failed', orderId);

    const res = await fireWebhook(ref);
    expect(res.status).toBe(200);

    const [pay] = await db.select().from(orderPayments).where(eq(orderPayments.id, paymentRowId));
    expect(pay!.status).toBe('failed');
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.financialStatus).toBe('pending_payment'); // niet 'paid'
    spy.mockRestore();
  });

  it("status 'canceled' downgradet een AL-betaalde order niet", async () => {
    const ref = `tr_cancel_${RUN}`;
    const { orderId, paymentRowId } = await seedOrder({
      orderNumber: `MW-CANCEL-${RUN}`,
      paymentReference: ref,
      orderStatus: 'paid',
      financialStatus: 'paid',
      paymentStatus: 'paid',
    });
    const spy = mockGetPayment('canceled', orderId);

    const res = await fireWebhook(ref);
    expect(res.status).toBe(200);

    // De fast-path (order al paid + payment al paid) laat alles met rust.
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.financialStatus).toBe('paid');
    expect(order!.status).toBe('paid');
    const [pay] = await db.select().from(orderPayments).where(eq(orderPayments.id, paymentRowId));
    expect(pay!.status).toBe('paid');
    spy.mockRestore();
  });
});

describe('mollie webhook — verdediging', () => {
  it('metadata.orderId-mismatch → skip (geen mutatie)', async () => {
    const ref = `tr_mismatch_${RUN}`;
    const { orderId, paymentRowId } = await seedOrder({
      orderNumber: `MW-MISMATCH-${RUN}`,
      paymentReference: ref,
    });
    // getPayment meldt 'paid' maar voor een ANDER order-id → handler skipt.
    const spy = mockGetPayment('paid', '00000000-0000-4000-8000-0000000000ff');

    const res = await fireWebhook(ref);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).skipped).toBe('order_mismatch');

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.financialStatus).toBe('pending_payment'); // ongewijzigd
    const [pay] = await db.select().from(orderPayments).where(eq(orderPayments.id, paymentRowId));
    expect(pay!.status).toBe('pending');
    const ledger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId));
    expect(ledger).toHaveLength(0);
    spy.mockRestore();
  });

  it('4xx op verify → 200 ack (geen retry, geen mutatie)', async () => {
    const ref = `tr_4xx_${RUN}`;
    const { orderId } = await seedOrder({
      orderNumber: `MW-4XX-${RUN}`,
      paymentReference: ref,
    });
    const spy = vi
      .spyOn(MollieProvider.prototype, 'getPayment')
      .mockRejectedValue(new PaymentProviderError('not found', 404));

    const res = await fireWebhook(ref);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).skipped).toBe('verify_4xx');

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.financialStatus).toBe('pending_payment');
    spy.mockRestore();
  });

  it('5xx op verify → 503 (Mollie mag retryen)', async () => {
    const ref = `tr_5xx_${RUN}`;
    await seedOrder({ orderNumber: `MW-5XX-${RUN}`, paymentReference: ref });
    const spy = vi
      .spyOn(MollieProvider.prototype, 'getPayment')
      .mockRejectedValue(new PaymentProviderError('upstream down', 503));

    const res = await fireWebhook(ref);
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe('verify_failed');
    spy.mockRestore();
  });

  it('onbekende payment-id → 200 ack', async () => {
    const res = await fireWebhook(`tr_unknown_${RUN}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).skipped).toBe('unknown_payment');
  });

  it('ontbrekende id → 200 ack', async () => {
    const res = await app().request('/api/payments/mollie/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).skipped).toBe('no_id');
  });
});
