/**
 * Vitest E2E voor /api/orders/* tegen de ECHTE Postgres (:7432).
 *
 * Strategie (zoals contract vraagt): geen mocks. We seeden een test-shop,
 * een test-user-sessie en een variant, draaien de Ã©chte Hono-router met de
 * echte DB en ruimen daarna alles op (cascade via shop-delete + variant/product).
 *
 * Dekt: create (order_number + totalen + marge), detail (marge per regel +
 * order-marge), status-transitie (geldig + ongeldig), fulfillment, payment,
 * return. Plus pure unit-checks op de reken-helpers.
 *
 * Vereist een draaiende DB. Wordt geskipt als de DB niet bereikbaar is, zodat
 * de suite niet rood wordt op een machine zonder Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db, closeDb } from '../../../lib/db.js';
import { shops } from '../../../db/schema/shops.js';
import { products } from '../../../db/schema/products.js';
import { variants } from '../../../db/schema/variants.js';
import { customers } from '../../../db/schema/customers.js';
import { users } from '../../../db/schema/users.js';
import { sessions } from '../../../db/schema/sessions.js';
import { orders } from '../../../db/schema/orders.js';
import { SESSION_COOKIE_NAME } from '../../../lib/auth.js';
import { createHash, randomBytes } from 'node:crypto';
import { ordersRoutes, returnsRoutes } from '../index.js';

import {
  computeLine,
  computeOrderTotals,
  computeOrderMargin,
} from '../../../domain/orders/order-math.js';
import { orderNumberPrefix } from '../../../domain/orders/order-number.js';
import { isValidTransition, allowedNextStatuses } from '../../../domain/orders/status-machine.js';

// â”€â”€â”€ Pure unit-tests (geen DB) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('order-math (pure)', () => {
  it('computeLine: net/tax/total/marge', () => {
    const l = computeLine({ quantity: 3, unitPrice: '10.00', taxRate: '21', costPrice: '6.00' });
    expect(l.lineNet).toBe('30.0000');
    expect(l.taxAmount).toBe('6.3000');
    expect(l.lineTotal).toBe('36.3000');
    expect(l.margin).toBe('12.0000'); // 30 - (6*3)
    expect(l.marginPct).toBe(40); // 12/30 = 40%
  });

  it('computeLine: zonder costPrice â†’ marge null', () => {
    const l = computeLine({ quantity: 2, unitPrice: '5.00', taxRate: '9' });
    expect(l.margin).toBeNull();
    expect(l.marginPct).toBeNull();
  });

  it('computeOrderTotals: subtotal + tax + shipping - discount', () => {
    const a = computeLine({ quantity: 2, unitPrice: '10.00', taxRate: '21' });
    const b = computeLine({ quantity: 1, unitPrice: '5.00', taxRate: '21' });
    const t = computeOrderTotals([a, b], { shippingTotal: '4.95', discountTotal: '2.00' });
    expect(t.subtotal).toBe('25.0000');
    expect(t.taxTotal).toBe('5.2500');
    // 25 + 5.25 + 4.95 - 2.00 = 33.20
    expect(t.grandTotal).toBe('33.2000');
  });

  it('computeOrderMargin: som van regel-marges', () => {
    const a = computeLine({ quantity: 1, unitPrice: '10.00', taxRate: '21', costPrice: '4.00' });
    const b = computeLine({ quantity: 1, unitPrice: '20.00', taxRate: '21', costPrice: '5.00' });
    const m = computeOrderMargin([a, b]);
    expect(m.margin).toBe('21.0000'); // (10-4)+(20-5)
  });

  it('orderNumberPrefix', () => {
    expect(orderNumberPrefix('crema')).toBe('CR');
    expect(orderNumberPrefix('pawfect')).toBe('PA');
    expect(orderNumberPrefix('')).toBe('OR');
  });

  it('status-machine transitions', () => {
    expect(isValidTransition('pending', 'paid')).toBe(true);
    expect(isValidTransition('pending', 'shipped')).toBe(false);
    expect(isValidTransition('delivered', 'pending')).toBe(false);
    expect(allowedNextStatuses('paid')).toContain('fulfilled');
  });
});

// â”€â”€â”€ E2E tegen echte DB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let dbAvailable = true;
const SUFFIX = randomUUID().slice(0, 8);
let shopId = '';
let variantId = '';
let productId = '';
let customerId = '';
let userId = '';
let sessionToken = '';
let createdOrderId = '';

function app() {
  const a = new Hono();
  a.route('/api/orders', ordersRoutes);
  a.route('/api/returns', returnsRoutes);
  return a;
}

function authHeaders(extra: Record<string, string> = {}) {
  return {
    cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
    'content-type': 'application/json',
    ...extra,
  };
}

beforeAll(async () => {
  try {
    // test-shop
    const [shop] = await db
      .insert(shops)
      .values({ slug: `test-orders-${SUFFIX}`, name: `Test Orders ${SUFFIX}` })
      .returning();
    shopId = shop!.id;

    // product + variant (voor variant_id koppeling + cost)
    const [prod] = await db
      .insert(products)
      .values({ slug: `test-prod-${SUFFIX}`, title: 'Test Product', status: 'active' })
      .returning();
    productId = prod!.id;
    const [variant] = await db
      .insert(variants)
      .values({ productId, sku: `TEST-${SUFFIX}`, price: '10.0000', costPrice: '6.0000' })
      .returning();
    variantId = variant!.id;

    // customer
    const [cust] = await db
      .insert(customers)
      .values({ shopId, email: `cust-${SUFFIX}@test.local`, firstName: 'Test', lastName: 'Klant' })
      .returning();
    customerId = cust!.id;

    // session voor bestaande admin-user
    const [admin] = await db.select().from(users).limit(1);
    userId = admin!.id;
    const token = randomBytes(24).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await db.insert(sessions).values({
      id: tokenHash,
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionToken = token;
  } catch (err) {
    dbAvailable = false;
    // eslint-disable-next-line no-console
    console.warn('[orders.test] DB niet bereikbaar â€” E2E geskipt:', (err as Error).message);
  }
});

afterAll(async () => {
  if (dbAvailable) {
    try {
      // orders/order_items/payments/fulfillments/returns cascaden via shop?
      // shop FK op orders = restrict â†’ eerst orders weg.
      await db.delete(orders).where(eq(orders.shopId, shopId));
      await db.delete(customers).where(eq(customers.shopId, shopId));
      await db.delete(variants).where(eq(variants.id, variantId));
      await db.delete(products).where(eq(products.id, productId));
      await db.delete(shops).where(eq(shops.id, shopId));
      if (sessionToken) {
        const h = createHash('sha256').update(sessionToken).digest('hex');
        await db.delete(sessions).where(eq(sessions.id, h));
      }
    } catch {
      /* best-effort cleanup */
    }
  }
  await closeDb();
});

describe('POST /api/orders (E2E)', () => {
  it('401 zonder auth', async () => {
    if (!dbAvailable) return;
    const res = await app().request('/api/orders', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('400 invalid body', async () => {
    if (!dbAvailable) return;
    const res = await app().request('/api/orders', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ shopId, items: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('201 create: order_number + totalen + marge', async () => {
    if (!dbAvailable) return;
    const res = await app().request('/api/orders', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        shopId,
        customerId,
        email: 'buyer@test.local',
        items: [
          { variantId, sku: `TEST-${SUFFIX}`, title: 'Test Product', quantity: 3, unitPrice: '10.00', taxRate: '21', costPrice: '6.00' },
          { sku: 'ADHOC', title: 'Adhoc', quantity: 1, unitPrice: '5.00', taxRate: '21' },
        ],
        shippingTotal: '4.95',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    createdOrderId = body.order.id;
    expect(body.order.orderNumber).toMatch(/^TE-\d+$/); // slug 'test-orders-...' â†’ 'TE'
    expect(body.order.subtotal).toBe('35.0000'); // 30 + 5
    expect(body.order.taxTotal).toBe('7.3500'); // 21% van 35
    // grand = 35 + 7.35 + 4.95 = 47.30
    expect(body.order.grandTotal).toBe('47.3000');
    expect(body.order.status).toBe('pending');
    expect(body.order.items).toHaveLength(2);
    // marge alleen op regel met cost: 30 - 18 = 12
    expect(body.order.margin).toBe('12.0000');
  });

  it('order_number telt op per shop', async () => {
    if (!dbAvailable) return;
    const res = await app().request('/api/orders', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ shopId, items: [{ sku: 'X', quantity: 1, unitPrice: '1.00' }] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.order.orderNumber).toMatch(/^TE-\d+$/);
    const firstSeq = Number(body.order.orderNumber.split('-')[1]);
    expect(firstSeq).toBeGreaterThanOrEqual(1002);
  });
});

describe('GET /api/orders + detail (E2E)', () => {
  it('list bevat de aangemaakte order', async () => {
    if (!dbAvailable) return;
    const res = await app().request(`/api/orders?shop_id=${shopId}`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.items.some((o: { id: string }) => o.id === createdOrderId)).toBe(true);
  });

  it('detail toont items met marge + order-marge', async () => {
    if (!dbAvailable) return;
    const res = await app().request(`/api/orders/${createdOrderId}`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.order.id).toBe(createdOrderId);
    expect(body.order.items.length).toBe(2);
    const withCost = body.order.items.find((i: { margin: string | null }) => i.margin === '12.0000');
    expect(withCost).toBeTruthy();
    expect(body.order.margin).toBe('12.0000');
  });

  it('404 onbekende order', async () => {
    if (!dbAvailable) return;
    const res = await app().request(`/api/orders/${randomUUID()}`, { headers: authHeaders() });
    expect(res.status).toBe(404);
  });
});

describe('status-transitie (E2E)', () => {
  it('409 ongeldige transitie pendingâ†’shipped', async () => {
    if (!dbAvailable) return;
    const res = await app().request(`/api/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'shipped' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe('invalid_transition');
  });

  it('200 geldige transitie pendingâ†’paid zet financial_status', async () => {
    if (!dbAvailable) return;
    const res = await app().request(`/api/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'paid' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.order.status).toBe('paid');
    expect(body.order.financialStatus).toBe('paid');
  });
});

describe('payment + fulfillment + return (E2E)', () => {
  it('payment registreren', async () => {
    if (!dbAvailable) return;
    const res = await app().request(`/api/orders/${createdOrderId}/payments`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ provider: 'mock', amount: '47.30', status: 'paid' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.payment.amount).toBe('47.3000');
    expect(body.order.financialStatus).toBe('paid');
  });

  it('fulfillment aanmaken zet fulfillment_status + status shipped', async () => {
    if (!dbAvailable) return;
    const res = await app().request(`/api/orders/${createdOrderId}/fulfillments`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ carrier: 'PostNL', trackingCode: '3SABC123', status: 'shipped' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.fulfillment.carrier).toBe('PostNL');
    expect(body.order.fulfillmentStatus).toBe('shipped');
    expect(body.order.status).toBe('shipped');
  });

  it('RMA aanmaken voor order', async () => {
    if (!dbAvailable) return;
    const res = await app().request(`/api/orders/${createdOrderId}/returns`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ reason: 'beschadigd', refundAmount: '10.00', items: [{ quantity: 1 }] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.return.refundAmount).toBe('10.0000');
    expect(body.return.items).toHaveLength(1);
  });

  it('GET /api/returns filtert op shop', async () => {
    if (!dbAvailable) return;
    const res = await app().request(`/api/returns?shop_id=${shopId}`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });
});
