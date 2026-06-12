/**
 * Vitest — multi-user scoping voor /api/discounts tegen de ECHTE Postgres.
 *
 * Mutabele requireAuth-mock (admin ↔ tenant, zie customers-scoping.test.ts).
 * Tenant is member van shop A; shop B is vreemd; daarnaast bestaat er een
 * GLOBALE discount (shopId NULL) die voor tenants onzichtbaar moet zijn.
 *
 * Dekt: list (globaal + vreemde shop onzichtbaar, expliciet vreemd shop_id →
 * 404), detail 404 voor globaal/vreemd, create zonder shopId → 400, create op
 * vreemde shop → 404, patch naar globaal → 400. Admin-gedrag ongewijzigd.
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
const { discounts } = await import('../../../db/schema/discounts.js');
const { discountRoutes } = await import('../index.js');

function buildApp() {
  const app = new Hono();
  app.route('/api/discounts', discountRoutes);
  return app;
}
const app = buildApp();

const ADMIN = { ...currentUser };
const RUN = Date.now().toString(36).toUpperCase();

let shopAId: string;
let shopBId: string;
let tenantId: string;
let discountAId: string;
let discountBId: string;
let globalDiscountId: string;
const createdDiscountIds: string[] = [];

function asTenant() {
  currentUser = { id: tenantId, email: `tenant-d-${RUN}@example.com`, role: 'user' };
}
function asAdmin() {
  currentUser = ADMIN;
}

beforeAll(async () => {
  const [shopA] = await db
    .insert(shops)
    .values({ slug: `vt-disc-a-${RUN.toLowerCase()}`, name: `Disc Scoping A ${RUN}` })
    .returning();
  const [shopB] = await db
    .insert(shops)
    .values({ slug: `vt-disc-b-${RUN.toLowerCase()}`, name: `Disc Scoping B ${RUN}` })
    .returning();
  shopAId = shopA!.id;
  shopBId = shopB!.id;

  const [tenant] = await db
    .insert(users)
    .values({ email: `tenant-d-${RUN}@example.com`, passwordHash: 'x', role: 'user' })
    .returning();
  tenantId = tenant!.id;
  await db.insert(shopMembers).values({ shopId: shopAId, userId: tenantId, role: 'owner' });

  const [dA] = await db
    .insert(discounts)
    .values({ code: `SCOPEA${RUN}`, shopId: shopAId, type: 'percentage', value: '10' })
    .returning();
  const [dB] = await db
    .insert(discounts)
    .values({ code: `SCOPEB${RUN}`, shopId: shopBId, type: 'percentage', value: '10' })
    .returning();
  const [dG] = await db
    .insert(discounts)
    .values({ code: `SCOPEG${RUN}`, shopId: null, type: 'fixed', value: '5' })
    .returning();
  discountAId = dA!.id;
  discountBId = dB!.id;
  globalDiscountId = dG!.id;
  createdDiscountIds.push(discountAId, discountBId, globalDiscountId);
});

afterAll(async () => {
  await db.delete(discounts).where(inArray(discounts.id, createdDiscountIds));
  await db.delete(users).where(eq(users.id, tenantId)); // shop_members cascade
  await db.delete(shops).where(inArray(shops.id, [shopAId, shopBId]));
  await closeDb();
});

describe('GET /api/discounts — list-scoping', () => {
  it('tenant ziet alleen member-shop-discounts; globale NIET', async () => {
    asTenant();
    const res = await app.request('/api/discounts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items.some((d: any) => d.id === discountAId)).toBe(true);
    expect(body.items.some((d: any) => d.id === discountBId)).toBe(false);
    expect(body.items.some((d: any) => d.id === globalDiscountId)).toBe(false);
    expect(body.items.every((d: any) => d.shopId === shopAId)).toBe(true);
  });

  it('tenant met expliciet vreemd shop_id → 404', async () => {
    asTenant();
    const res = await app.request(`/api/discounts?shop_id=${shopBId}`);
    expect(res.status).toBe(404);
  });

  it('admin ziet alles incl. globale discounts (geconsolideerd)', async () => {
    asAdmin();
    const res = await app.request(`/api/discounts?q=SCOPE`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    for (const id of [discountAId, discountBId, globalDiscountId]) {
      expect(body.items.some((d: any) => d.id === id)).toBe(true);
    }
  });
});

describe('GET /api/discounts/:id — detail-scoping', () => {
  it('tenant: eigen 200, vreemd + globaal 404', async () => {
    asTenant();
    expect((await app.request(`/api/discounts/${discountAId}`)).status).toBe(200);
    expect((await app.request(`/api/discounts/${discountBId}`)).status).toBe(404);
    expect((await app.request(`/api/discounts/${globalDiscountId}`)).status).toBe(404);
  });

  it('tenant: redemptions van globale discount ook 404', async () => {
    asTenant();
    const res = await app.request(`/api/discounts/${globalDiscountId}/redemptions`);
    expect(res.status).toBe(404);
  });

  it('admin: globale discount gewoon 200', async () => {
    asAdmin();
    expect((await app.request(`/api/discounts/${globalDiscountId}`)).status).toBe(200);
  });
});

describe('POST/PATCH — create/update-scoping', () => {
  it('tenant: create zonder shopId (globaal) → 400', async () => {
    asTenant();
    const res = await app.request('/api/discounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: `TGLOB${RUN}`, type: 'percentage', value: '10' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_request');
  });

  it('tenant: create op vreemde shop → 404', async () => {
    asTenant();
    const res = await app.request('/api/discounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: `TFOREIGN${RUN}`,
        type: 'percentage',
        value: '10',
        shopId: shopBId,
      }),
    });
    expect(res.status).toBe(404);
  });

  it('tenant: create op eigen shop → 201', async () => {
    asTenant();
    const res = await app.request('/api/discounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: `TOWN${RUN}`,
        type: 'percentage',
        value: '10',
        shopId: shopAId,
      }),
    });
    expect(res.status).toBe(201);
    createdDiscountIds.push(((await res.json()) as any).discount.id);
  });

  it('tenant: patch eigen discount naar globaal (shopId null) → 400', async () => {
    asTenant();
    const res = await app.request(`/api/discounts/${discountAId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId: null }),
    });
    expect(res.status).toBe(400);
  });

  it('tenant: patch van andermans/globale discount → 404', async () => {
    asTenant();
    for (const id of [discountBId, globalDiscountId]) {
      const res = await app.request(`/api/discounts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: false }),
      });
      expect(res.status).toBe(404);
    }
  });
});
