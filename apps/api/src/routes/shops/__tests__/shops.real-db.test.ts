/**
 * REAL-DB integratie-test voor de shops-module.
 *
 * Mount de echte `shopsRoutes` via Hono `app.request()` tegen de ECHTE
 * Postgres op 127.0.0.1:7432 (uit `.env`, DATABASE_URL = webshop_crm).
 *
 * Flow:
 *   1. maak een echte sessie voor de seed-admin â†’ krijg een session-cookie
 *   2. POST  /api/shops                      â†’ maak een test-shop
 *   3. GET   /api/shops/:id                  â†’ lees terug
 *   4. PATCH /api/shops/:id                  â†’ update naam
 *   5. PUT   /api/shops/:id/products/:pid    â†’ publiceer een bestaand demo-product
 *   6. GET   /api/shops/:id/products         â†’ zie de publicatie terug
 *   7. cleanup: DELETE de shop (cascade ruimt shop_products op) + sessie + audit
 *
 * Alle gemaakte rijen worden in `afterAll` opgeruimd. Tests gebruiken unieke
 * slugs (timestamp) zodat herhaald draaien geen unique-clash geeft.
 *
 * VEREIST een draaiende DB met minstens 1 admin-user + 1 product (seed:demo).
 * Als de DB niet bereikbaar is faalt de test luid â€” dat is bewust (contract:
 * "echt testen").
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../../../lib/db.js';
import { users } from '../../../db/schema/users.js';
import { products } from '../../../db/schema/products.js';
import { shops } from '../../../db/schema/shops.js';
import { auditLog } from '../../../db/schema/audit-log.js';
import { createSession, invalidateSession, SESSION_COOKIE_NAME } from '../../../lib/auth.js';
import type { AuthVariables } from '../../../middleware/auth.js';
import { shopsRoutes } from '../index.js';

function buildApp() {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.route('/api/shops', shopsRoutes);
  return app;
}

function cookieHeader(token: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

const app = buildApp();
const SLUG = `vitest-shop-${Date.now()}`;

let sessionToken = '';
let adminUserId = '';
let demoProductId = '';
let createdShopId = '';
/** Onthoud aparte handle voor cleanup; createdShopId wordt '' na DELETE-test. */
let cleanupShopId = '';

beforeAll(async () => {
  const [admin] = await db.select().from(users).limit(1);
  if (!admin) throw new Error('TEST PRECONDITION: geen users in DB â€” draai `pnpm seed`.');
  adminUserId = admin.id;

  const [product] = await db.select().from(products).limit(1);
  if (!product)
    throw new Error('TEST PRECONDITION: geen products in DB â€” draai `pnpm seed:demo`.');
  demoProductId = product.id;

  const session = await createSession(adminUserId);
  sessionToken = session.cookie;
});

afterAll(async () => {
  // Cleanup in omgekeerde volgorde. shop_products cascade'n mee met de shop.
  // `cleanupShopId` blijft gezet ook nadat de DELETE-test createdShopId leeg
  // maakte, zodat we de shop + alle gegenereerde audit-rows opruimen.
  if (cleanupShopId) {
    await db.delete(shops).where(eq(shops.id, cleanupShopId));
    // Audit-rows met entity_id = shop id (create/update/delete van de shop).
    await db.delete(auditLog).where(eq(auditLog.entityId, cleanupShopId));
    // shop_product-audit heeft entity_id = shop_product id; die rijen laten we
    // staan (audit is append-only by design) â€” ze refereren naar een
    // verwijderde shop en zijn verder onschadelijk.
  }
  if (sessionToken) await invalidateSession(sessionToken);
  await closeDb();
});

describe('shops module â€” real DB', () => {
  it('401 zonder sessie-cookie', async () => {
    const res = await app.request('/api/shops');
    expect(res.status).toBe(401);
  });

  it('400 bij ongeldige create-body', async () => {
    const res = await app.request('/api/shops', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cookieHeader(sessionToken) },
      body: JSON.stringify({ name: 'No slug' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe('invalid_request');
  });

  it('POST /api/shops maakt een echte shop aan (201)', async () => {
    const res = await app.request('/api/shops', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cookieHeader(sessionToken) },
      body: JSON.stringify({
        slug: SLUG,
        name: 'Vitest Test Shop',
        currency: 'EUR',
        locale: 'nl-NL',
        status: 'draft',
        branding: { primaryColor: '#ff9f43', theme: 'ai-centrum' },
        vatConfig: { priceIncludesVat: true, defaultCountry: 'NL' },
        supportEmail: 'support@vitest.local',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.shop).toBeTruthy();
    expect(body.shop.slug).toBe(SLUG);
    expect(body.shop.status).toBe('draft');
    expect(body.shop.branding.primaryColor).toBe('#ff9f43');
    expect(typeof body.shop.createdAt).toBe('string');
    createdShopId = body.shop.id;
    cleanupShopId = body.shop.id;
    expect(createdShopId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('409 bij dubbele slug', async () => {
    const res = await app.request('/api/shops', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cookieHeader(sessionToken) },
      body: JSON.stringify({ slug: SLUG, name: 'Dupe' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe('slug_taken');
  });

  it('GET /api/shops/:id leest de shop terug', async () => {
    const res = await app.request(`/api/shops/${createdShopId}`, {
      headers: cookieHeader(sessionToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.shop.id).toBe(createdShopId);
    expect(body.shop.slug).toBe(SLUG);
  });

  it('GET /api/shops bevat de nieuwe shop in de lijst', async () => {
    const res = await app.request(`/api/shops?search=${SLUG}`, {
      headers: cookieHeader(sessionToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items.some((s: { id: string }) => s.id === createdShopId)).toBe(true);
  });

  it('PATCH /api/shops/:id werkt de naam bij', async () => {
    const res = await app.request(`/api/shops/${createdShopId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...cookieHeader(sessionToken) },
      body: JSON.stringify({ name: 'Vitest Test Shop (updated)', status: 'active' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.shop.name).toBe('Vitest Test Shop (updated)');
    expect(body.shop.status).toBe('active');
  });

  it('PUT /api/shops/:id/products/:productId publiceert een demo-product (201)', async () => {
    const res = await app.request(
      `/api/shops/${createdShopId}/products/${demoProductId}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...cookieHeader(sessionToken) },
        body: JSON.stringify({ published: true, priceOverride: '19.9900', position: 1 }),
      },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.shopProduct.published).toBe(true);
    expect(body.shopProduct.priceOverride).toBe('19.9900');
    expect(body.shopProduct.position).toBe(1);
    expect(body.shopProduct.publishedAt).toBeTruthy();
    expect(body.shopProduct.product.id).toBe(demoProductId);
  });

  it('PUT opnieuw = update (200), idempotent op de (shop, product)-paar', async () => {
    const res = await app.request(
      `/api/shops/${createdShopId}/products/${demoProductId}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...cookieHeader(sessionToken) },
        body: JSON.stringify({ priceOverride: '24.5000' }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.shopProduct.priceOverride).toBe('24.5000');
    // published bleef true (niet meegegeven â†’ behouden)
    expect(body.shopProduct.published).toBe(true);
  });

  it('GET /api/shops/:id/products toont de publicatie', async () => {
    const res = await app.request(`/api/shops/${createdShopId}/products`, {
      headers: cookieHeader(sessionToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBeGreaterThanOrEqual(1);
    const entry = body.items.find(
      (i: { productId: string }) => i.productId === demoProductId,
    );
    expect(entry).toBeTruthy();
    expect(entry.published).toBe(true);
    expect(entry.priceOverride).toBe('24.5000');
    expect(entry.product.id).toBe(demoProductId);
  });

  it('GET /api/shops/:id/products?publishedOnly=true filtert', async () => {
    // unpublish het product
    await app.request(`/api/shops/${createdShopId}/products/${demoProductId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...cookieHeader(sessionToken) },
      body: JSON.stringify({ published: false }),
    });
    const res = await app.request(
      `/api/shops/${createdShopId}/products?publishedOnly=true`,
      { headers: cookieHeader(sessionToken) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const entry = body.items.find(
      (i: { productId: string }) => i.productId === demoProductId,
    );
    expect(entry).toBeUndefined();
  });

  it('404 bij publiceren onbekend product', async () => {
    const res = await app.request(
      `/api/shops/${createdShopId}/products/00000000-0000-4000-8000-000000000000`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...cookieHeader(sessionToken) },
        body: JSON.stringify({ published: true }),
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe('product_not_found');
  });

  it('DELETE /api/shops/:id verwijdert de shop (cascade)', async () => {
    const res = await app.request(`/api/shops/${createdShopId}`, {
      method: 'DELETE',
      headers: cookieHeader(sessionToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);

    // Verifieer: weg uit DB.
    const rows = await db.select().from(shops).where(eq(shops.id, createdShopId));
    expect(rows).toHaveLength(0);
    // De afterAll-cleanup hoeft de shop dan niet meer te verwijderen.
    createdShopId = '';
  });
});
