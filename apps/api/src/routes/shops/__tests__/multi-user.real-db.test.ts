/**
 * REAL-DB integratie-test voor de multi-user scoping van shops + cms.
 *
 * Zelfde strategie als shops.real-db.test.ts: echte Postgres (127.0.0.1:7432),
 * echte sessies via `createSession`, router gemount via Hono `app.request()`.
 *
 * Scenario:
 *   - admin   = bestaande seed-admin (role 'admin', ziet alles)
 *   - tenantA = verse user met role 'user' → maakt een shop → wordt owner
 *   - tenantB = verse user met role 'user' → géén member → ziet niets
 *
 * Dekt: shops-list-scoping, shop-detail/storefront-token 404 voor non-member,
 * members add/remove (incl. idempotentie, staff-403, user_not_found),
 * last-owner-guard (409), product-ownership bij publiceren en cms-list-scoping
 * (pages + globale media read-only voor tenants).
 *
 * Alles wordt in `afterAll` opgeruimd (shop-cascade + users + sessies + audit).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from '../../../lib/db.js';
import { users } from '../../../db/schema/users.js';
import { shops } from '../../../db/schema/shops.js';
import { products } from '../../../db/schema/products.js';
import { cmsMedia } from '../../../db/schema/index.js';
import { auditLog } from '../../../db/schema/audit-log.js';
import { createSession, invalidateSession, SESSION_COOKIE_NAME } from '../../../lib/auth.js';
import type { AuthVariables } from '../../../middleware/auth.js';
import { shopsRoutes } from '../index.js';
import { cmsRoutes } from '../../cms/index.js';

function buildApp() {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.route('/api/shops', shopsRoutes);
  app.route('/api/cms', cmsRoutes);
  return app;
}

function asUser(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...extra };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

const app = buildApp();
const RUN = Date.now();
const SLUG_A = `vitest-mu-shop-${RUN}`;

let adminToken = '';
let tokenA = '';
let tokenB = '';
let tenantAId = '';
let tenantBId = '';
let tenantBEmail = '';
let shopAId = '';
let platformProductId = '';
let ownProductId = '';
let globalMediaId = '';
const sessionTokens: string[] = [];

beforeAll(async () => {
  // Seed-admin (role 'admin') voor het admin-perspectief.
  const [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (!admin) throw new Error('TEST PRECONDITION: geen admin-user in DB — draai `pnpm seed`.');

  // Twee verse tenants met role 'user'.
  const [a] = await db
    .insert(users)
    .values({ email: `vitest-mu-a-${RUN}@test.local`, passwordHash: 'x', role: 'user' })
    .returning();
  const [b] = await db
    .insert(users)
    .values({ email: `Vitest-MU-B-${RUN}@Test.Local`, passwordHash: 'x', role: 'user' })
    .returning();
  if (!a || !b) throw new Error('kon test-users niet aanmaken');
  tenantAId = a.id;
  tenantBId = b.id;
  tenantBEmail = b.email;

  for (const userId of [admin.id, a.id, b.id]) {
    const session = await createSession(userId);
    sessionTokens.push(session.cookie);
  }
  [adminToken, tokenA, tokenB] = sessionTokens as [string, string, string];

  // Platform-product (ownerUserId NULL) + eigen product van tenant A.
  const [platform] = await db
    .insert(products)
    .values({ slug: `vitest-mu-platform-${RUN}`, title: 'Platform Product', status: 'active' })
    .returning();
  const [own] = await db
    .insert(products)
    .values({
      slug: `vitest-mu-own-${RUN}`,
      title: 'Eigen Product A',
      status: 'active',
      ownerUserId: a.id,
    })
    .returning();
  platformProductId = platform!.id;
  ownProductId = own!.id;

  // Globale media-asset (shop_id NULL) — leesbaar voor iedereen, read-only voor tenants.
  const [media] = await db
    .insert(cmsMedia)
    .values({ shopId: null, url: `https://test.local/mu-${RUN}.png`, filename: `mu-${RUN}.png` })
    .returning();
  globalMediaId = media!.id;
});

afterAll(async () => {
  if (shopAId) {
    await db.delete(shops).where(eq(shops.id, shopAId));
    await db.delete(auditLog).where(eq(auditLog.entityId, shopAId));
  }
  if (globalMediaId) await db.delete(cmsMedia).where(eq(cmsMedia.id, globalMediaId));
  const productIds = [platformProductId, ownProductId].filter(Boolean);
  if (productIds.length > 0) await db.delete(products).where(inArray(products.id, productIds));
  for (const token of sessionTokens) await invalidateSession(token);
  const userIds = [tenantAId, tenantBId].filter(Boolean);
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
  await closeDb();
});

describe('multi-user scoping — real DB', () => {
  // ─── shops: create + auto-ownership ──────────────────────────
  it('tenant maakt een shop en wordt automatisch owner-member', async () => {
    const res = await app.request('/api/shops', {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...asUser(tokenA) },
      body: JSON.stringify({ slug: SLUG_A, name: 'Multi-user Shop A' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    shopAId = body.shop.id;

    const membersRes = await app.request(`/api/shops/${shopAId}/members`, {
      headers: asUser(tokenA),
    });
    expect(membersRes.status).toBe(200);
    const members = (await membersRes.json()) as any;
    expect(members.total).toBe(1);
    expect(members.items[0].userId).toBe(tenantAId);
    expect(members.items[0].role).toBe('owner');
  });

  // ─── shops: list-scoping ─────────────────────────────────────
  it('GET /api/shops toont een tenant alleen member-shops', async () => {
    const resA = await app.request('/api/shops?limit=100', { headers: asUser(tokenA) });
    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as any;
    expect(bodyA.total).toBe(1);
    expect(bodyA.items.map((s: { id: string }) => s.id)).toEqual([shopAId]);

    // Non-member ziet een lege lijst.
    const resB = await app.request('/api/shops?limit=100', { headers: asUser(tokenB) });
    expect(resB.status).toBe(200);
    const bodyB = (await resB.json()) as any;
    expect(bodyB.total).toBe(0);
    expect(bodyB.items).toEqual([]);

    // Admin ziet de shop wél (geconsolideerd).
    const resAdmin = await app.request(`/api/shops?search=${SLUG_A}`, {
      headers: asUser(adminToken),
    });
    const bodyAdmin = (await resAdmin.json()) as any;
    expect(bodyAdmin.items.some((s: { id: string }) => s.id === shopAId)).toBe(true);
  });

  // ─── shops: detail/mutaties 404 voor non-member ──────────────
  it('shop-detail, patch, delete en storefront-token geven 404 voor een non-member', async () => {
    const detail = await app.request(`/api/shops/${shopAId}`, { headers: asUser(tokenB) });
    expect(detail.status).toBe(404);
    expect(((await detail.json()) as any).error).toBe('not_found');

    const patch = await app.request(`/api/shops/${shopAId}`, {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, ...asUser(tokenB) },
      body: JSON.stringify({ name: 'Hacked' }),
    });
    expect(patch.status).toBe(404);

    const del = await app.request(`/api/shops/${shopAId}`, {
      method: 'DELETE',
      headers: asUser(tokenB),
    });
    expect(del.status).toBe(404);

    const token = await app.request(`/api/shops/${shopAId}/storefront-token`, {
      headers: asUser(tokenB),
    });
    expect(token.status).toBe(404);

    const productsRes = await app.request(`/api/shops/${shopAId}/products`, {
      headers: asUser(tokenB),
    });
    expect(productsRes.status).toBe(404);
    expect(((await productsRes.json()) as any).error).toBe('shop_not_found');

    // Member zelf kan er gewoon bij.
    const ownDetail = await app.request(`/api/shops/${shopAId}`, { headers: asUser(tokenA) });
    expect(ownDetail.status).toBe(200);
  });

  // ─── shops: product-ownership bij publiceren ─────────────────
  it('tenant kan alleen eigen producten publiceren (platform-product → 404)', async () => {
    const platform = await app.request(`/api/shops/${shopAId}/products/${platformProductId}`, {
      method: 'PUT',
      headers: { ...JSON_HEADERS, ...asUser(tokenA) },
      body: JSON.stringify({ published: true }),
    });
    expect(platform.status).toBe(404);
    expect(((await platform.json()) as any).error).toBe('product_not_found');

    const own = await app.request(`/api/shops/${shopAId}/products/${ownProductId}`, {
      method: 'PUT',
      headers: { ...JSON_HEADERS, ...asUser(tokenA) },
      body: JSON.stringify({ published: true }),
    });
    expect(own.status).toBe(201);
    expect(((await own.json()) as any).shopProduct.published).toBe(true);
  });

  // ─── members: add (idempotent) / staff-403 / user_not_found ──
  it('owner voegt member toe op e-mail; idempotent; staff mag geen members beheren', async () => {
    // Case-insensitive e-mail-lookup (B is met mixed-case opgeslagen).
    const add = await app.request(`/api/shops/${shopAId}/members`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...asUser(tokenA) },
      body: JSON.stringify({ email: tenantBEmail.toLowerCase() }),
    });
    expect(add.status).toBe(201);
    const added = (await add.json()) as any;
    expect(added.member.userId).toBe(tenantBId);
    expect(added.member.role).toBe('staff');

    // Idempotent: nogmaals toevoegen → 200, zelfde member.
    const again = await app.request(`/api/shops/${shopAId}/members`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...asUser(tokenA) },
      body: JSON.stringify({ email: tenantBEmail, role: 'owner' }),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).member.role).toBe('staff'); // role ongewijzigd

    // B is nu member en ziet de shop.
    const detail = await app.request(`/api/shops/${shopAId}`, { headers: asUser(tokenB) });
    expect(detail.status).toBe(200);

    // Maar als staff mag B géén members beheren.
    const staffAdd = await app.request(`/api/shops/${shopAId}/members`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...asUser(tokenB) },
      body: JSON.stringify({ email: 'whoever@test.local' }),
    });
    expect(staffAdd.status).toBe(403);
    expect(((await staffAdd.json()) as any).error).toBe('forbidden');

    // Onbekende e-mail → 404 user_not_found.
    const unknown = await app.request(`/api/shops/${shopAId}/members`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...asUser(tokenA) },
      body: JSON.stringify({ email: `bestaat-niet-${RUN}@test.local` }),
    });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as any).error).toBe('user_not_found');
  });

  // ─── members: remove + last-owner-guard ──────────────────────
  it('owner verwijdert member; laatste owner is beschermd (409 last_owner)', async () => {
    const listRes = await app.request(`/api/shops/${shopAId}/members`, {
      headers: asUser(tokenA),
    });
    const list = (await listRes.json()) as any;
    const memberB = list.items.find((m: { userId: string }) => m.userId === tenantBId);
    const memberA = list.items.find((m: { userId: string }) => m.userId === tenantAId);
    expect(memberB).toBeTruthy();
    expect(memberA).toBeTruthy();

    // Laatste owner verwijderen → 409.
    const guard = await app.request(`/api/shops/${shopAId}/members/${memberA.id}`, {
      method: 'DELETE',
      headers: asUser(tokenA),
    });
    expect(guard.status).toBe(409);
    expect(((await guard.json()) as any).error).toBe('last_owner');

    // Staff-member verwijderen → ok; B verliest direct toegang.
    const del = await app.request(`/api/shops/${shopAId}/members/${memberB.id}`, {
      method: 'DELETE',
      headers: asUser(tokenA),
    });
    expect(del.status).toBe(200);
    const detail = await app.request(`/api/shops/${shopAId}`, { headers: asUser(tokenB) });
    expect(detail.status).toBe(404);
  });

  // ─── cms: list-scoping ───────────────────────────────────────
  it('cms-routes zijn shop-gescoped: non-member krijgt 404 shop_not_found', async () => {
    // Tenant A maakt een page in zijn shop.
    const create = await app.request('/api/cms/pages', {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...asUser(tokenA) },
      body: JSON.stringify({ shopId: shopAId, title: `MU Test ${RUN}` }),
    });
    expect(create.status).toBe(201);

    const listA = await app.request(`/api/cms/pages?shop=${shopAId}`, {
      headers: asUser(tokenA),
    });
    expect(listA.status).toBe(200);
    expect(((await listA.json()) as any).total).toBeGreaterThanOrEqual(1);

    // Non-member → 404 shop_not_found (zelfde response als onbekende shop).
    const listB = await app.request(`/api/cms/pages?shop=${shopAId}`, {
      headers: asUser(tokenB),
    });
    expect(listB.status).toBe(404);
    expect(((await listB.json()) as any).error).toBe('shop_not_found');

    // Admin ziet alles.
    const listAdmin = await app.request(`/api/cms/pages?shop=${shopAId}`, {
      headers: asUser(adminToken),
    });
    expect(listAdmin.status).toBe(200);

    // Ook detail/mutaties via X-Shop-Id zijn dicht voor non-members.
    const blocksB = await app.request('/api/cms/blocks', {
      headers: asUser(tokenB, { 'x-shop-id': shopAId }),
    });
    expect(blocksB.status).toBe(404);
  });

  // ─── cms: globale media leesbaar, maar read-only voor tenants ─
  it('globale media: tenant mag lezen maar niet muteren/uploaden zonder eigen shop', async () => {
    // Lezen mag (gedeelde assets).
    const list = await app.request('/api/cms/media?scope=global&limit=200', {
      headers: asUser(tokenA),
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as any;
    expect(body.items.some((m: { id: string }) => m.id === globalMediaId)).toBe(true);

    // Muteren/verwijderen niet (403 forbidden).
    const patch = await app.request(`/api/cms/media/${globalMediaId}`, {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, ...asUser(tokenA) },
      body: JSON.stringify({ alt: 'hack' }),
    });
    expect(patch.status).toBe(403);
    const del = await app.request(`/api/cms/media/${globalMediaId}`, {
      method: 'DELETE',
      headers: asUser(tokenA),
    });
    expect(del.status).toBe(403);

    // Registreren zonder eigen shop → 400 shop_required.
    const register = await app.request('/api/cms/media', {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...asUser(tokenA) },
      body: JSON.stringify({ url: 'https://test.local/x.png', filename: 'x.png' }),
    });
    expect(register.status).toBe(400);
    expect(((await register.json()) as any).error).toBe('shop_required');

    // Mét eigen shop → 201.
    const ok = await app.request('/api/cms/media', {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...asUser(tokenA) },
      body: JSON.stringify({
        shopId: shopAId,
        url: `https://test.local/own-${RUN}.png`,
        filename: `own-${RUN}.png`,
      }),
    });
    expect(ok.status).toBe(201);
    // (media van shop A wordt in afterAll niet ge-cascade'd door shop-delete?
    //  jawel: cms_media.shop_id heeft FK op shops — maar voor de zekerheid:)
    const created = (await ok.json()) as any;
    await db.delete(cmsMedia).where(eq(cmsMedia.id, created.media.id));
  });
});
