/**
 * Vitest — multi-user scoping voor /api/customers tegen de ECHTE Postgres.
 *
 * Zelfde strategie als customers.test.ts (geen db-mock, gemockte requireAuth)
 * maar met een MUTABELE `currentUser`: tenant (role 'user', member van shop A)
 * vs admin. Shop B is "andermans" shop.
 *
 * Dekt: customer-create op andermans shop → 404, list-scoping (incl. expliciet
 * vreemd shopId → 404), detail/adressen/orders-historie 404 voor andermans
 * klant. Admin-gedrag ongewijzigd.
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
const { shops, customers } = await import('../../../db/schema/index.js');
const { users } = await import('../../../db/schema/users.js');
const { shopMembers } = await import('../../../db/schema/shop-members.js');
const { customersRoutes } = await import('../index.js');

function buildApp() {
  const app = new Hono();
  app.route('/api/customers', customersRoutes);
  return app;
}
const app = buildApp();

const ADMIN = { ...currentUser };
const RUN = Date.now().toString(36);

let shopAId: string;
let shopBId: string;
let tenantId: string;
let customerAId: string;
let customerBId: string;

function asTenant() {
  currentUser = { id: tenantId, email: `tenant-c-${RUN}@example.com`, role: 'user' };
}
function asAdmin() {
  currentUser = ADMIN;
}

beforeAll(async () => {
  const [shopA] = await db
    .insert(shops)
    .values({ slug: `vt-cust-a-${RUN}`, name: `Cust Scoping A ${RUN}` })
    .returning();
  const [shopB] = await db
    .insert(shops)
    .values({ slug: `vt-cust-b-${RUN}`, name: `Cust Scoping B ${RUN}` })
    .returning();
  shopAId = shopA!.id;
  shopBId = shopB!.id;

  const [tenant] = await db
    .insert(users)
    .values({ email: `tenant-c-${RUN}@example.com`, passwordHash: 'x', role: 'user' })
    .returning();
  tenantId = tenant!.id;
  await db.insert(shopMembers).values({ shopId: shopAId, userId: tenantId, role: 'owner' });

  const [custA] = await db
    .insert(customers)
    .values({ shopId: shopAId, email: `a-${RUN}@example.com` })
    .returning();
  const [custB] = await db
    .insert(customers)
    .values({ shopId: shopBId, email: `b-${RUN}@example.com` })
    .returning();
  customerAId = custA!.id;
  customerBId = custB!.id;
});

afterAll(async () => {
  await db.delete(customers).where(inArray(customers.shopId, [shopAId, shopBId]));
  await db.delete(users).where(eq(users.id, tenantId)); // shop_members cascade
  await db.delete(shops).where(inArray(shops.id, [shopAId, shopBId]));
  await closeDb();
});

describe('POST /api/customers — create-scoping', () => {
  it('tenant: create op andermans shop → 404 shop_not_found', async () => {
    asTenant();
    const res = await app.request('/api/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId: shopBId, email: `nope-${RUN}@example.com` }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe('shop_not_found');
  });

  it('tenant: create op eigen shop → 201', async () => {
    asTenant();
    const res = await app.request('/api/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId: shopAId, email: `own-${RUN}@example.com` }),
    });
    expect(res.status).toBe(201);
  });
});

describe('GET /api/customers — list-scoping', () => {
  it('tenant ziet alleen klanten van member-shops', async () => {
    asTenant();
    const res = await app.request('/api/customers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items.some((cu: any) => cu.id === customerAId)).toBe(true);
    expect(body.items.some((cu: any) => cu.id === customerBId)).toBe(false);
    expect(body.items.every((cu: any) => cu.shopId === shopAId)).toBe(true);
  });

  it('tenant met expliciet vreemd shopId → 404', async () => {
    asTenant();
    const res = await app.request(`/api/customers?shopId=${shopBId}`);
    expect(res.status).toBe(404);
  });

  it('admin ziet klanten van beide shops (geconsolideerd)', async () => {
    asAdmin();
    const res = await app.request(`/api/customers?shopId=${shopBId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items.some((cu: any) => cu.id === customerBId)).toBe(true);
  });
});

describe('detail + sub-routes — scoping', () => {
  it('tenant: eigen klant 200, andermans klant 404', async () => {
    asTenant();
    const own = await app.request(`/api/customers/${customerAId}`);
    expect(own.status).toBe(200);

    const foreign = await app.request(`/api/customers/${customerBId}`);
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as any).error).toBe('not_found');
  });

  it('tenant: adressen + orders-historie van andermans klant → 404', async () => {
    asTenant();
    const addr = await app.request(`/api/customers/${customerBId}/addresses`);
    expect(addr.status).toBe(404);
    const hist = await app.request(`/api/customers/${customerBId}/orders`);
    expect(hist.status).toBe(404);
  });

  it('tenant: patch/delete van andermans klant → 404', async () => {
    asTenant();
    const patch = await app.request(`/api/customers/${customerBId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'hack' }),
    });
    expect(patch.status).toBe(404);
    const del = await app.request(`/api/customers/${customerBId}`, { method: 'DELETE' });
    expect(del.status).toBe(404);
  });

  it('admin: andermans klant gewoon 200', async () => {
    asAdmin();
    const res = await app.request(`/api/customers/${customerBId}`);
    expect(res.status).toBe(200);
  });
});
