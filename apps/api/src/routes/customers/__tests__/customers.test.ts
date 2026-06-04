/**
 * Vitest â€” /api/customers tegen de ECHTE Postgres (:7432).
 *
 * Strategie (zie WAVE1-BACKEND-CONTRACT.md):
 *   - GEEN db-mock. We praten met de echte DB via Hono `app.request()`.
 *   - requireAuth wordt ge-mockt (no-op + fake user) zodat we geen
 *     sessie-cookie hoeven te regelen â€” de DB-laag is wat we testen.
 *   - We maken een eigen wegwerp-shop + klant + adres aan en ruimen ALLES
 *     op in afterAll (cascade ruimt addresses; we deleten de shop expliciet).
 *
 * Draaien:
 *   pnpm -C apps/api --filter @webshop-crm/api test
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// â”€â”€â”€ Mock alleen de auth-middleware (no-op + fake admin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// vi.mock wordt door vitest naar de top gehoist; de factory draait dus vÃ³Ã³r
// de late `await import(...)` hieronder.
vi.mock('../../../middleware/auth.js', () => ({
  requireAuth: async (c: any, next: any) => {
    c.set('user', {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'test@example.com',
      role: 'admin',
    });
    await next();
  },
}));

// Late imports zodat de auth-mock actief is.
const { Hono } = await import('hono');
const { db, closeDb } = await import('../../../lib/db.js');
const { shops, customers } = await import('../../../db/schema/index.js');
const { customersRoutes } = await import('../index.js');

function buildApp() {
  const app = new Hono();
  app.route('/api/customers', customersRoutes);
  return app;
}

const app = buildApp();

// Unieke marker zodat parallel-runs / re-runs niet botsen.
const RUN = Date.now().toString(36);
const SHOP_SLUG = `vitest-cust-${RUN}`;
const EMAIL = `vitest-${RUN}@example.com`;

let shopId: string;
const createdCustomerIds: string[] = [];

beforeAll(async () => {
  const [shop] = await db
    .insert(shops)
    .values({ slug: SHOP_SLUG, name: `Vitest Shop ${RUN}` })
    .returning();
  if (!shop) throw new Error('failed to create test shop');
  shopId = shop.id;
});

afterAll(async () => {
  // customers cascade-deleten hun addresses; daarna de shop weg.
  for (const id of createdCustomerIds) {
    await db.delete(customers).where(eq(customers.id, id));
  }
  if (shopId) await db.delete(shops).where(eq(shops.id, shopId));
  await closeDb();
});

describe('POST /api/customers', () => {
  it('400 invalid body (missing shopId/email)', async () => {
    const res = await app.request('/api/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_request');
  });

  it('404 unknown shop', async () => {
    const res = await app.request('/api/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shopId: '11111111-1111-1111-1111-111111111111',
        email: `ghost-${RUN}@example.com`,
      }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe('shop_not_found');
  });

  it('201 happy: creates B2B customer', async () => {
    const res = await app.request('/api/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shopId,
        email: EMAIL,
        firstName: 'Test',
        lastName: 'Klant',
        company: 'Acme BV',
        vatNumber: 'NL123456789B01',
        tags: ['vip', 'b2b'],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.customer).toMatchObject({
      shopId,
      email: EMAIL,
      company: 'Acme BV',
      vatNumber: 'NL123456789B01',
      ordersCount: 0,
      totalSpent: '0.0000',
    });
    expect(body.customer.tags).toEqual(['vip', 'b2b']);
    createdCustomerIds.push(body.customer.id);
  });

  it('409 duplicate email in same shop', async () => {
    const res = await app.request('/api/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId, email: EMAIL }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe('email_taken');
  });
});

describe('GET /api/customers', () => {
  it('200 list filtered by shopId + search finds our customer', async () => {
    const res = await app.request(
      `/api/customers?shopId=${shopId}&search=Acme`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items.some((c: any) => c.email === EMAIL)).toBe(true);
  });

  it('400 invalid shopId', async () => {
    const res = await app.request('/api/customers?shopId=not-a-uuid');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/customers/:id', () => {
  it('400 invalid uuid', async () => {
    const res = await app.request('/api/customers/nope');
    expect(res.status).toBe(400);
  });

  it('404 unknown id', async () => {
    const res = await app.request(
      '/api/customers/22222222-2222-2222-2222-222222222222',
    );
    expect(res.status).toBe(404);
  });

  it('200 detail with empty addresses', async () => {
    const id = createdCustomerIds[0]!;
    const res = await app.request(`/api/customers/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.customer.id).toBe(id);
    expect(Array.isArray(body.addresses)).toBe(true);
  });
});

describe('PATCH /api/customers/:id', () => {
  it('200 updates company + notes', async () => {
    const id = createdCustomerIds[0]!;
    const res = await app.request(`/api/customers/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company: 'Acme Holding BV', notes: 'belangrijk' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.customer.company).toBe('Acme Holding BV');
    expect(body.customer.notes).toBe('belangrijk');
  });

  it('400 empty patch', async () => {
    const id = createdCustomerIds[0]!;
    const res = await app.request(`/api/customers/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('addresses CRUD', () => {
  let addressId: string;
  let secondAddressId: string;

  it('201 create default shipping address', async () => {
    const id = createdCustomerIds[0]!;
    const res = await app.request(`/api/customers/${id}/addresses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'shipping',
        isDefault: true,
        name: 'Test Klant',
        line1: 'Hoofdstraat 1',
        postcode: '1011AA',
        city: 'Amsterdam',
        country: 'nl',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.address).toMatchObject({
      type: 'shipping',
      isDefault: true,
      city: 'Amsterdam',
      country: 'NL', // uppercased door zod
    });
    addressId = body.address.id;
  });

  it('201 second default shipping unsets the first', async () => {
    const id = createdCustomerIds[0]!;
    const res = await app.request(`/api/customers/${id}/addresses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'shipping',
        isDefault: true,
        line1: 'Tweede straat 2',
        city: 'Rotterdam',
        country: 'NL',
      }),
    });
    expect(res.status).toBe(201);
    secondAddressId = ((await res.json()) as any).address.id;

    // List terug: precies Ã©Ã©n default shipping.
    const listRes = await app.request(`/api/customers/${id}/addresses`);
    const list = (await listRes.json()) as any;
    const shippingDefaults = list.addresses.filter(
      (a: any) => a.type === 'shipping' && a.isDefault,
    );
    expect(shippingDefaults).toHaveLength(1);
    expect(shippingDefaults[0].id).toBe(secondAddressId);
  });

  it('200 patch address', async () => {
    const id = createdCustomerIds[0]!;
    const res = await app.request(
      `/api/customers/${id}/addresses/${addressId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ city: 'Utrecht' }),
      },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).address.city).toBe('Utrecht');
  });

  it('404 patch address that belongs to another customer-path', async () => {
    const id = createdCustomerIds[0]!;
    const res = await app.request(
      `/api/customers/${id}/addresses/33333333-3333-3333-3333-333333333333`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ city: 'X' }),
      },
    );
    expect(res.status).toBe(404);
  });

  it('200 delete address', async () => {
    const id = createdCustomerIds[0]!;
    const res = await app.request(
      `/api/customers/${id}/addresses/${addressId}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).deleted).toBe(true);
  });
});

describe('GET /api/customers/:id/orders', () => {
  it('200 empty history for fresh customer', async () => {
    const id = createdCustomerIds[0]!;
    const res = await app.request(`/api/customers/${id}/orders`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  it('404 unknown customer', async () => {
    const res = await app.request(
      '/api/customers/44444444-4444-4444-4444-444444444444/orders',
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/customers/:id', () => {
  it('200 delete then 404 on re-get', async () => {
    // Maak een wegwerp-klant die we hier opruimen.
    const createRes = await app.request('/api/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId, email: `del-${RUN}@example.com` }),
    });
    const id = ((await createRes.json()) as any).customer.id;

    const delRes = await app.request(`/api/customers/${id}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(200);
    expect(((await delRes.json()) as any).deleted).toBe(true);

    const getRes = await app.request(`/api/customers/${id}`);
    expect(getRes.status).toBe(404);
  });
});
