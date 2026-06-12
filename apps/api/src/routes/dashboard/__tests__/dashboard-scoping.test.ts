/**
 * Vitest — multi-user scoping voor /api/dashboard/kpis tegen de ECHTE Postgres.
 *
 * Mutabele requireAuth-mock (admin ↔ tenant). Tenant is member van shop A;
 * shop B is vreemd. We seeden één betaalde order per shop binnen het
 * 30-daags venster en checken dat de tenant-KPI's alleen shop A meetellen.
 *
 * Dekt: revenue gescoped op member-shops, openOrders gescoped, expliciet
 * vreemd shop_id → 404, tenant zonder memberships → 0-KPI's, admin
 * geconsolideerd (ongewijzigd).
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
const { dashboardRoutes } = await import('../index.js');

function buildApp() {
  const app = new Hono();
  app.route('/api/dashboard', dashboardRoutes);
  return app;
}
const app = buildApp();

const ADMIN = { ...currentUser };
const RUN = Date.now().toString(36);

let shopAId: string;
let shopBId: string;
let tenantId: string;
let lonerId: string; // tenant ZONDER memberships

function asTenant() {
  currentUser = { id: tenantId, email: `tenant-k-${RUN}@example.com`, role: 'user' };
}
function asLoner() {
  currentUser = { id: lonerId, email: `loner-k-${RUN}@example.com`, role: 'user' };
}
function asAdmin() {
  currentUser = ADMIN;
}

beforeAll(async () => {
  const [shopA] = await db
    .insert(shops)
    .values({ slug: `vt-kpi-a-${RUN}`, name: `KPI Scoping A ${RUN}` })
    .returning();
  const [shopB] = await db
    .insert(shops)
    .values({ slug: `vt-kpi-b-${RUN}`, name: `KPI Scoping B ${RUN}` })
    .returning();
  shopAId = shopA!.id;
  shopBId = shopB!.id;

  const [tenant] = await db
    .insert(users)
    .values({ email: `tenant-k-${RUN}@example.com`, passwordHash: 'x', role: 'user' })
    .returning();
  tenantId = tenant!.id;
  await db.insert(shopMembers).values({ shopId: shopAId, userId: tenantId, role: 'owner' });

  const [loner] = await db
    .insert(users)
    .values({ email: `loner-k-${RUN}@example.com`, passwordHash: 'x', role: 'user' })
    .returning();
  lonerId = loner!.id;

  // Betaalde (revenue) + open orders per shop, binnen het default-venster.
  await db.insert(orders).values([
    {
      shopId: shopAId,
      orderNumber: 'KPI-1001',
      status: 'paid',
      financialStatus: 'paid',
      subtotal: '100.0000',
      grandTotal: '121.0000',
    },
    {
      shopId: shopBId,
      orderNumber: 'KPI-1001',
      status: 'paid',
      financialStatus: 'paid',
      subtotal: '40.0000',
      grandTotal: '48.4000',
    },
  ]);
});

afterAll(async () => {
  await db.delete(orders).where(inArray(orders.shopId, [shopAId, shopBId]));
  await db.delete(users).where(inArray(users.id, [tenantId, lonerId])); // members cascade
  await db.delete(shops).where(inArray(shops.id, [shopAId, shopBId]));
  await closeDb();
});

describe('GET /api/dashboard/kpis — multi-user scoping', () => {
  it('tenant: revenue + openOrders alleen van member-shop A', async () => {
    asTenant();
    const res = await app.request('/api/dashboard/kpis');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Alleen de 100.00 van shop A — de 40.00 van shop B telt niet mee.
    expect(body.revenue30d).toBe(100);
    expect(body.openOrders).toBe(1);
  });

  it('tenant met expliciet vreemd shop_id → 404 not_found', async () => {
    asTenant();
    const res = await app.request(`/api/dashboard/kpis?shop_id=${shopBId}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe('not_found');
  });

  it('tenant zonder memberships → 0-KPI\'s (lege lijst, geen error)', async () => {
    asLoner();
    const res = await app.request('/api/dashboard/kpis');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.revenue30d).toBe(0);
    expect(body.openOrders).toBe(0);
    expect(body.lowStockCount).toBe(0);
    expect(body.topProducts).toEqual([]);
  });

  it('tenant: channels leeg (globale admin-infra)', async () => {
    asTenant();
    const res = await app.request('/api/dashboard/kpis');
    const body = (await res.json()) as any;
    expect(body.channels).toEqual([]);
  });

  it('admin: geconsolideerd over beide shops (ongewijzigd gedrag)', async () => {
    asAdmin();
    const res = await app.request(`/api/dashboard/kpis?shop_id=${shopBId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.revenue30d).toBe(40);
  });
});
