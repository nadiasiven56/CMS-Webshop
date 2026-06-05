/**
 * Unit-tests voor het publieke order-status-endpoint
 * (GET /api/storefront/v1/orders/:orderNumber/status).
 *
 * Draait tegen de echte Postgres (:7432). Seedt 1 shop + 3 orders met de
 * relevante status-combinaties en verifieert de afgeleide betaal-state, plus
 * 404 (onbekend), shop-scoping en 400 (geen shop).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { inArray } from 'drizzle-orm';
import { db, closeDb } from '../../../lib/db.js';
import { shops, orders } from '../../../db/schema/index.js';
import { orderPayments } from '../../../db/schema/order-payments.js';
import { storefrontRoutes } from '../index.js';

const RUN = Date.now().toString(36);
const SHOP_SLUG = `os-test-${RUN}`;
const OTHER_SLUG = `os-other-${RUN}`;

let shopId: string;
let otherShopId: string;
const orderIds: string[] = [];

function app() {
  const a = new Hono();
  a.route('/api/storefront/v1', storefrontRoutes);
  return a;
}

function statusReq(slug: string | null, orderNumber: string) {
  const headers: Record<string, string> = {};
  if (slug) headers['X-Shop-Slug'] = slug;
  return app().request(
    `/api/storefront/v1/orders/${encodeURIComponent(orderNumber)}/status`,
    { headers },
  );
}

async function seedOrder(
  orderNumber: string,
  orderStatus: string,
  financialStatus: string,
  paymentStatus: string,
): Promise<void> {
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      orderNumber,
      status: orderStatus,
      financialStatus,
      grandTotal: '42.0000',
    })
    .returning();
  orderIds.push(order!.id);
  await db.insert(orderPayments).values({
    orderId: order!.id,
    provider: 'mollie',
    status: paymentStatus,
    amount: '42.0000',
  });
}

beforeAll(async () => {
  const [shop] = await db
    .insert(shops)
    .values({ slug: SHOP_SLUG, name: 'OS Test' })
    .returning();
  shopId = shop!.id;
  const [other] = await db
    .insert(shops)
    .values({ slug: OTHER_SLUG, name: 'OS Other' })
    .returning();
  otherShopId = other!.id;

  await seedOrder('OS-PAID', 'paid', 'paid', 'paid');
  // Webhook laat bij een mislukte betaling financial_status op 'pending_payment'
  // staan en zet alleen de payment-row op 'failed'.
  await seedOrder('OS-FAIL', 'pending', 'pending_payment', 'failed');
  await seedOrder('OS-PEND', 'pending', 'pending_payment', 'pending');
});

afterAll(async () => {
  if (orderIds.length) {
    await db.delete(orderPayments).where(inArray(orderPayments.orderId, orderIds));
    await db.delete(orders).where(inArray(orders.id, orderIds));
  }
  await db.delete(shops).where(inArray(shops.id, [shopId, otherShopId]));
  await closeDb();
});

describe('GET /orders/:orderNumber/status', () => {
  it('betaalde order -> state paid', async () => {
    const res = await statusReq(SHOP_SLUG, 'OS-PAID');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.order.state).toBe('paid');
    expect(body.order.orderNumber).toBe('OS-PAID');
  });

  it('mislukte betaling -> state failed', async () => {
    const res = await statusReq(SHOP_SLUG, 'OS-FAIL');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.order.state).toBe('failed');
  });

  it('betaling onderweg -> state pending', async () => {
    const res = await statusReq(SHOP_SLUG, 'OS-PEND');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.order.state).toBe('pending');
  });

  it('onbekende order -> 404', async () => {
    const res = await statusReq(SHOP_SLUG, 'OS-NOPE');
    expect(res.status).toBe(404);
  });

  it('shop-scoped: order van shop A niet zichtbaar voor shop B', async () => {
    const res = await statusReq(OTHER_SLUG, 'OS-PAID');
    expect(res.status).toBe(404);
  });

  it('zonder shop-identifier -> 400', async () => {
    const res = await statusReq(null, 'OS-PAID');
    expect(res.status).toBe(400);
  });
});
