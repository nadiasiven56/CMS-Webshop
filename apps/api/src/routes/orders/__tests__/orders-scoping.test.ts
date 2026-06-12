/**
 * Vitest — multi-user scoping voor /api/orders + /api/returns tegen de ECHTE
 * Postgres (:7432).
 *
 * Strategie (zie customers.test.ts): GEEN db-mock; requireAuth wordt gemockt
 * met een MUTABELE `currentUser` zodat we per request als admin of tenant
 * kunnen optreden. De tenant is een echte users-row (FK shop_members) die
 * member is van shop A — shop B is "andermans" shop.
 *
 * Dekt: orders-list-scoping (tenant ziet alleen eigen-shop-orders, expliciet
 * vreemd shop_id → 404), order-detail 404 voor andermans order, order-create
 * op andermans shop → 404, returns-board scoping. Admin blijft alles zien.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

// ─── Mock auth: mutabele user (admin ↔ tenant) ──────────────────────
let currentUser: { id: string; email: string; role: string } = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'admin@example.com',
  role: 'admin',
};
vi.mock('../../../middleware/auth.js', () => ({
  requireAuth: async (c: any, next: any) => {
    c.set('user', currentUser);
    await next();
  },
}));

// Late imports zodat de auth-mock actief is.
const { Hono } = await import('hono');
const { db, closeDb } = await import('../../../lib/db.js');
const { shops } = await import('../../../db/schema/shops.js');
const { users } = await import('../../../db/schema/users.js');
const { shopMembers } = await import('../../../db/schema/shop-members.js');
const { orders } = await import('../../../db/schema/orders.js');
const { returns } = await import('../../../db/schema/returns.js');
const { ordersRoutes, returnsRoutes } = await import('../index.js');

function buildApp() {
  const app = new Hono();
  app.route('/api/orders', ordersRoutes);
  app.route('/api/returns', returnsRoutes);
  return app;
}
const app = buildApp();

const ADMIN = { ...currentUser };
const RUN = Date.now().toString(36);

let shopAId: string;
let shopBId: string;
let tenantId: string;
let orderAId: string;
let orderBId: string;

function asTenant() {
  currentUser = { id: tenantId, email: `tenant-${RUN}@example.com`, role: 'user' };
}
function asAdmin() {
  currentUser = ADMIN;
}

beforeAll(async () => {
  const [shopA] = await db
    .insert(shops)
    .values({ slug: `vt-ord-a-${RUN}`, name: `Scoping A ${RUN}` })
    .returning();
  const [shopB] = await db
    .insert(shops)
    .values({ slug: `vt-ord-b-${RUN}`, name: `Scoping B ${RUN}` })
    .returning();
  shopAId = shopA!.id;
  shopBId = shopB!.id;

  // Tenant = echte users-row (FK shop_members), member van alleen shop A.
  const [tenant] = await db
    .insert(users)
    .values({
      email: `tenant-${RUN}@example.com`,
      passwordHash: 'x',
      role: 'user',
    })
    .returning();
  tenantId = tenant!.id;
  await db.insert(shopMembers).values({ shopId: shopAId, userId: tenantId, role: 'owner' });

  // Eén order per shop (direct geïnsert; create-route is apart getest).
  const [orderA] = await db
    .insert(orders)
    .values({ shopId: shopAId, orderNumber: 'SC-1001', subtotal: '10.0000', grandTotal: '12.1000' })
    .returning();
  const [orderB] = await db
    .insert(orders)
    .values({ shopId: shopBId, orderNumber: 'SC-1001', subtotal: '20.0000', grandTotal: '24.2000' })
    .returning();
  orderAId = orderA!.id;
  orderBId = orderB!.id;

  // Eén return per shop voor het RMA-board.
  await db.insert(returns).values({ shopId: shopAId, orderId: orderAId, refundAmount: '1.0000', status: 'requested' });
  await db.insert(returns).values({ shopId: shopBId, orderId: orderBId, refundAmount: '2.0000', status: 'requested' });
});

afterAll(async () => {
  asAdmin();
  await db.delete(returns).where(inArray(returns.shopId, [shopAId, shopBId]));
  await db.delete(orders).where(inArray(orders.shopId, [shopAId, shopBId]));
  await db.delete(users).where(eq(users.id, tenantId)); // shop_members cascade
  await db.delete(shops).where(inArray(shops.id, [shopAId, shopBId]));
  await closeDb();
});

describe('GET /api/orders — list-scoping', () => {
  it('tenant ziet alleen orders van member-shops', async () => {
    asTenant();
    const res = await app.request('/api/orders');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items.some((o: any) => o.id === orderAId)).toBe(true);
    expect(body.items.some((o: any) => o.id === orderBId)).toBe(false);
    expect(body.items.every((o: any) => o.shopId === shopAId)).toBe(true);
  });

  it('tenant met expliciet vreemd shop_id → 404 not_found', async () => {
    asTenant();
    const res = await app.request(`/api/orders?shop_id=${shopBId}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe('not_found');
  });

  it('admin ziet orders van beide shops (geconsolideerd)', async () => {
    asAdmin();
    const res = await app.request(`/api/orders?shop_id=${shopBId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items.some((o: any) => o.id === orderBId)).toBe(true);
  });
});

describe('GET /api/orders/:id — detail-scoping', () => {
  it('tenant: eigen order 200, andermans order 404 (zelfde shape)', async () => {
    asTenant();
    const own = await app.request(`/api/orders/${orderAId}`);
    expect(own.status).toBe(200);

    const foreign = await app.request(`/api/orders/${orderBId}`);
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as any).error).toBe('not_found');
  });

  it('tenant: sub-resources van andermans order ook 404', async () => {
    asTenant();
    for (const sub of ['payments', 'fulfillments']) {
      const res = await app.request(`/api/orders/${orderBId}/${sub}`);
      expect(res.status).toBe(404);
    }
  });

  it('admin: andermans order gewoon 200', async () => {
    asAdmin();
    const res = await app.request(`/api/orders/${orderBId}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/orders — create-scoping', () => {
  it('tenant: create op andermans shop → 404 shop_not_found', async () => {
    asTenant();
    const res = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shopId: shopBId,
        items: [{ sku: 'X', quantity: 1, unitPrice: '1.00' }],
      }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe('shop_not_found');
  });

  it('tenant: create op eigen shop → 201', async () => {
    asTenant();
    const res = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shopId: shopAId,
        items: [{ sku: 'X', quantity: 1, unitPrice: '1.00' }],
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe('GET /api/returns — RMA-board-scoping', () => {
  it('tenant ziet alleen returns van member-shops', async () => {
    asTenant();
    const res = await app.request('/api/returns');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.every((r: any) => r.shopId === shopAId)).toBe(true);
  });

  it('tenant met expliciet vreemd shop_id → 404', async () => {
    asTenant();
    const res = await app.request(`/api/returns?shop_id=${shopBId}`);
    expect(res.status).toBe(404);
  });

  it('tenant: create return op andermans shop → 404', async () => {
    asTenant();
    const res = await app.request('/api/returns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId: shopBId, items: [] }),
    });
    expect(res.status).toBe(404);
  });
});
