/**
 * Multi-user tests voor /api/products.
 *
 * Dekt de owner-scoping (products.owner_user_id):
 *   - POST  / als role 'user'  → ownerUserId = user.id
 *   - POST  / als role 'admin' → ownerUserId = null (platform-catalogus)
 *   - GET   / als role 'user'  → alleen eigen producten in de lijst
 *   - GET   /:id andermans product → 404 not_found (zelfde shape als onbestaand)
 *   - PATCH /:id andermans product → 404
 *   - DELETE /:id andermans product → 404
 *   - POST  /:id/variants andermans product → 404
 *
 * Zelfde mock-strategie als products.test.ts (stateful db-mock, geen Postgres),
 * uitgebreid met: (1) mutable auth-user, (2) capture van insert-values, en
 * (3) een owner-filter-extractor die de echte drizzle `eq(...)`-expressie op
 * `owner_user_id` uit de where-clause leest zodat de list-query gefilterd
 * teruggegeven wordt zoals Postgres dat zou doen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN = { id: '00000000-0000-0000-0000-0000000000ad', email: 'admin@test', role: 'admin' };
const USER_A = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', email: 'a@test', role: 'user' };
const USER_B = { id: 'bbbbbbbb-0000-4000-8000-00000000000b', email: 'b@test', role: 'user' };

// ─── Mutable auth-user ───────────────────────────────────────────────
const authState = { user: { ...ADMIN } as { id: string; email: string; role: string } };

vi.mock('../../../middleware/auth.js', () => ({
  requireAuth: async (c: any, next: any) => {
    c.set('user', authState.user);
    await next();
  },
}));

vi.mock('../../../middleware/idempotency.js', () => ({
  idempotency: async (_c: any, next: any) => {
    await next();
  },
}));

// ─── Mock state ──────────────────────────────────────────────────────
interface MockProductRow {
  id: string;
  slug: string;
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  status: 'draft' | 'active' | 'archived';
  tags: string[];
  ownerUserId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MockVariantRow {
  id: string;
  productId: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  costPrice: string | null;
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  barcode: string | null;
  selectedOptions: Record<string, string>;
  position: number;
  taxable: boolean;
  taxClass: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const state = {
  productsList: [] as MockProductRow[],
  insertProductReturning: undefined as MockProductRow | undefined,
  insertVariantReturning: undefined as MockVariantRow | undefined,
  insertedProductValues: [] as Array<Record<string, unknown>>,
};

function resetMockState(): void {
  state.productsList = [];
  state.insertProductReturning = undefined;
  state.insertVariantReturning = undefined;
  state.insertedProductValues = [];
}

/**
 * Leest de parameter-waarde van een `eq(products.ownerUserId, <value>)` uit
 * een (geneste) drizzle SQL-expressie. Geeft `undefined` terug als de
 * where-clause geen owner_user_id-conditie bevat.
 */
function extractOwnerFilter(expr: unknown): string | undefined {
  const visited = new Set<object>();
  let found: string | undefined;
  const walk = (node: unknown): void => {
    if (found !== undefined || !node || typeof node !== 'object') return;
    if (visited.has(node as object)) return;
    visited.add(node as object);
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) return;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] as { name?: unknown } | null;
      if (chunk && chunk.name === 'owner_user_id') {
        for (let j = i + 1; j < chunks.length; j++) {
          const p = chunks[j] as { value?: unknown; encoder?: unknown } | null;
          if (p && typeof p === 'object' && 'encoder' in p) {
            found = String(p.value);
            return;
          }
        }
      }
      walk(chunks[i]);
    }
  };
  walk(expr);
  return found;
}

// ─── Mock db ─────────────────────────────────────────────────────────
function flexibleMock() {
  const tableNameOf = (t: any): string => {
    if (!t || typeof t !== 'object') return '';
    const nameSym = (t as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
    if (typeof nameSym === 'string' && nameSym) return nameSym;
    return (t as { _?: { name?: string } })._?.name ?? '';
  };

  const select = (arg?: unknown) => {
    const isCount =
      typeof arg === 'object' && arg !== null && 'c' in (arg as Record<string, unknown>);
    let table = '';
    let ownerFilter: string | undefined;

    const productRows = (): MockProductRow[] =>
      ownerFilter !== undefined
        ? state.productsList.filter((p) => p.ownerUserId === ownerFilter)
        : state.productsList;

    const finalize = async (): Promise<unknown[]> => {
      if (table === 'products') {
        if (isCount) return [{ c: productRows().length }];
        return productRows();
      }
      return [];
    };

    const ch: any = {
      from: (t: any) => {
        table = tableNameOf(t);
        return ch;
      },
      where: (expr: unknown) => {
        const owner = extractOwnerFilter(expr);
        if (owner !== undefined) ownerFilter = owner;
        return ch;
      },
      orderBy: () => ch,
      limit: () => ch,
      offset: () => ch,
      groupBy: () => ch,
      then: (resolve: (v: unknown) => void) => Promise.resolve(finalize()).then(resolve as never),
    };
    return ch;
  };

  const insert = (table: any) => {
    const name = tableNameOf(table);
    return {
      values: (v: Record<string, unknown>) => {
        if (name === 'products') state.insertedProductValues.push(v);
        return {
          returning: async () => {
            if (name === 'products') {
              return state.insertProductReturning ? [state.insertProductReturning] : [];
            }
            if (name === 'variants') {
              return state.insertVariantReturning ? [state.insertVariantReturning] : [];
            }
            return [];
          },
          onConflictDoNothing: () => ({ returning: async () => [] }),
        };
      },
    };
  };

  const update = (_table: any) => ({
    set: (_patch: unknown) => ({ where: async () => undefined }),
  });

  const del = (_table: any) => ({ where: async () => undefined });

  const tx = { select, insert, update, delete: del };
  return {
    select,
    insert,
    update,
    delete: del,
    transaction: async <T>(cb: (txArg: typeof tx) => Promise<T>): Promise<T> => cb(tx),
  };
}

vi.mock('../../../lib/db.js', () => ({
  db: flexibleMock(),
  closeDb: async () => undefined,
  schema: {},
}));

// ─── App-builder (router LATE importeren zodat mocks actief zijn) ────
async function buildApp() {
  const { Hono } = await import('hono');
  const { productRoutes } = await import('../index.js');
  const app = new Hono();
  app.route('/api/products', productRoutes);
  return app;
}

const PRODUCT_A_ID = '11111111-2222-3333-4444-555555555555';
const PRODUCT_B_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

function makeProduct(overrides: Partial<MockProductRow>): MockProductRow {
  return {
    id: PRODUCT_A_ID,
    slug: 'sample',
    title: 'Sample',
    descriptionHtml: null,
    vendor: null,
    productType: null,
    status: 'draft',
    tags: [],
    ownerUserId: null,
    publishedAt: null,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    updatedAt: new Date('2026-06-01T10:00:00Z'),
    ...overrides,
  };
}

function makeVariant(productId: string): MockVariantRow {
  return {
    id: '99999999-8888-4777-8666-555555555555',
    productId,
    sku: 'SAMPLE-1',
    price: '10.0000',
    compareAtPrice: null,
    costPrice: null,
    weightG: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    barcode: null,
    selectedOptions: {},
    position: 0,
    taxable: true,
    taxClass: 'standard',
    active: true,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    updatedAt: new Date('2026-06-01T10:00:00Z'),
  };
}

beforeEach(() => {
  resetMockState();
  authState.user = { ...ADMIN };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/products — owner toekennen', () => {
  it("role 'user' → ownerUserId = user.id", async () => {
    authState.user = { ...USER_A };
    state.insertProductReturning = makeProduct({ ownerUserId: USER_A.id });
    state.insertVariantReturning = makeVariant(PRODUCT_A_ID);
    const app = await buildApp();
    const res = await app.request('/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Mijn product' }),
    });
    expect(res.status).toBe(201);
    expect(state.insertedProductValues).toHaveLength(1);
    expect(state.insertedProductValues[0]!.ownerUserId).toBe(USER_A.id);
    const body = (await res.json()) as any;
    expect(body.product.ownerUserId).toBe(USER_A.id);
  });

  it("role 'admin' → ownerUserId = null (platform-catalogus)", async () => {
    state.insertProductReturning = makeProduct({ ownerUserId: null });
    state.insertVariantReturning = makeVariant(PRODUCT_A_ID);
    const app = await buildApp();
    const res = await app.request('/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Platform product' }),
    });
    expect(res.status).toBe(201);
    expect(state.insertedProductValues).toHaveLength(1);
    expect(state.insertedProductValues[0]!.ownerUserId).toBe(null);
  });
});

describe('GET /api/products — list-scoping', () => {
  it("role 'user' ziet alleen eigen producten", async () => {
    state.productsList = [
      makeProduct({ id: PRODUCT_A_ID, slug: 'van-a', ownerUserId: USER_A.id }),
      makeProduct({ id: PRODUCT_B_ID, slug: 'van-b', ownerUserId: USER_B.id }),
    ];
    authState.user = { ...USER_A };
    const app = await buildApp();
    const res = await app.request('/api/products');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: PRODUCT_A_ID, ownerUserId: USER_A.id });
  });

  it('admin ziet alles (geen owner-filter)', async () => {
    state.productsList = [
      makeProduct({ id: PRODUCT_A_ID, slug: 'van-a', ownerUserId: USER_A.id }),
      makeProduct({ id: PRODUCT_B_ID, slug: 'van-b', ownerUserId: null }),
    ];
    const app = await buildApp();
    const res = await app.request('/api/products');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
  });
});

describe('GET /api/products/:id — detail-scoping', () => {
  it("404 not_found voor andermans product (role 'user')", async () => {
    state.productsList = [makeProduct({ ownerUserId: USER_B.id })];
    authState.user = { ...USER_A };
    const app = await buildApp();
    const res = await app.request(`/api/products/${PRODUCT_A_ID}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe('not_found');
  });

  it('404 voor platform-product (ownerUserId = null) als role user', async () => {
    state.productsList = [makeProduct({ ownerUserId: null })];
    authState.user = { ...USER_A };
    const app = await buildApp();
    const res = await app.request(`/api/products/${PRODUCT_A_ID}`);
    expect(res.status).toBe(404);
  });

  it('200 voor eigen product', async () => {
    state.productsList = [makeProduct({ ownerUserId: USER_A.id })];
    authState.user = { ...USER_A };
    const app = await buildApp();
    const res = await app.request(`/api/products/${PRODUCT_A_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.product.ownerUserId).toBe(USER_A.id);
  });

  it('200 voor admin op andermans product', async () => {
    state.productsList = [makeProduct({ ownerUserId: USER_A.id })];
    const app = await buildApp();
    const res = await app.request(`/api/products/${PRODUCT_A_ID}`);
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/products/:id — scoping', () => {
  it('404 voor andermans product', async () => {
    state.productsList = [makeProduct({ ownerUserId: USER_B.id })];
    authState.user = { ...USER_A };
    const app = await buildApp();
    const res = await app.request(`/api/products/${PRODUCT_A_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hack' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe('not_found');
  });
});

describe('DELETE /api/products/:id — scoping', () => {
  it('404 voor andermans product', async () => {
    state.productsList = [makeProduct({ ownerUserId: USER_B.id })];
    authState.user = { ...USER_A };
    const app = await buildApp();
    const res = await app.request(`/api/products/${PRODUCT_A_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe('not_found');
  });
});

describe('POST /api/products/:id/variants — scoping', () => {
  it('404 voor andermans product', async () => {
    state.productsList = [makeProduct({ ownerUserId: USER_B.id })];
    authState.user = { ...USER_A };
    const app = await buildApp();
    const res = await app.request(`/api/products/${PRODUCT_A_ID}/variants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sku: 'V-1', price: '5.00' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe('not_found');
  });
});
