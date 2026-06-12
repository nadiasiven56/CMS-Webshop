/**
 * POST /api/images/reorder/:productId  — bulk reorder happy path + 404.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbState = {
  productImages: [] as Array<{
    id: string;
    productId: string;
    url: string;
    alt: string | null;
    position: number;
    createdAt: Date;
  }>,
  audit: [] as unknown[],
};

vi.mock('../../../db/schema/products.js', () => ({ products: { __name: 'products' } }));
vi.mock('../../../db/schema/product-images.js', () => ({
  productImages: { __name: 'productImages' },
}));
vi.mock('../../../db/schema/audit-log.js', () => ({ auditLog: { __name: 'audit' } }));

vi.mock('drizzle-orm', () => ({
  eq: (_c: unknown, v: unknown) => ({ __id: v }),
  and: (...parts: unknown[]) => ({ __and: parts }),
  inArray: (_c: unknown, v: unknown[]) => ({ __ids: v }),
  sql: (..._a: unknown[]) => ({ __sql: true }),
}));

vi.mock('../../../lib/db.js', () => {
  const insert = (t: { __name: string }) => ({
    values(v: unknown) {
      if (t.__name === 'audit') dbState.audit.push(v);
      return {
        then(r: (v: unknown) => unknown) {
          return Promise.resolve(undefined).then(r);
        },
      };
    },
  });

  const update = (t: { __name: string }) => {
    let whereId: string | undefined;
    let patch: Record<string, unknown> = {};
    const chain = {
      set(p: Record<string, unknown>) {
        patch = p;
        return chain;
      },
      where(p: { __id?: string }) {
        whereId = p?.__id;
        return chain;
      },
      then(r: (v: unknown) => unknown) {
        if (t.__name === 'productImages') {
          const row = dbState.productImages.find((r) => r.id === whereId);
          if (row) Object.assign(row, patch);
        }
        return Promise.resolve(undefined).then(r);
      },
    };
    return chain;
  };

  const select = (cols?: unknown) => {
    let table: string | undefined;
    let whereIds: unknown[] | undefined;
    let whereId: string | undefined;
    const chain = {
      from(t: { __name: string }) {
        table = t.__name;
        return chain;
      },
      where(p: { __id?: string; __ids?: unknown[] }) {
        if (p?.__ids) whereIds = p.__ids;
        if (p?.__id) whereId = p.__id;
        return chain;
      },
      limit() {
        return chain;
      },
      then(r: (v: unknown) => unknown) {
        let rows: unknown[] = [];
        if (table === 'productImages') {
          if (whereIds) {
            rows = dbState.productImages
              .filter((row) => whereIds!.includes(row.id))
              .map((row) => ({ id: row.id, productId: row.productId }));
          } else if (whereId) {
            // could be by id OR by productId — rough match
            rows = dbState.productImages.filter(
              (row) => row.id === whereId || row.productId === whereId,
            );
          } else {
            rows = dbState.productImages;
          }
        }
        return Promise.resolve(rows).then(r);
      },
    };
    void cols;
    return chain;
  };

  const transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn({ insert, update, select });

  return { db: { insert, update, select, transaction }, schema: {} };
});

vi.mock('../../../lib/storage/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/storage/sanitize.js')>(
    '../../../lib/storage/sanitize.js',
  );
  return {
    ...actual,
    getStorage: () => ({
      put: async () => ({ key: '', url: '', size: 0 }),
      delete: async () => {},
      publicUrl: (k: string) => `http://test/storage/${k}`,
    }),
  };
});

vi.mock('../../../middleware/auth.js', () => ({
  requireAuth: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('user', { id: 'user-test-1', email: 'admin@test', role: 'admin' });
    await next();
  },
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const { imageRoutes } = await import('../index.js');
const { Hono } = await import('hono');

function buildApp() {
  const app = new Hono();
  app.route('/api/images', imageRoutes);
  return app;
}

const PROD_A = '11111111-1111-4111-8111-111111111111';
const PROD_B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  dbState.productImages = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', productId: PROD_A, url: '', alt: null, position: 0, createdAt: new Date() },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', productId: PROD_A, url: '', alt: null, position: 1, createdAt: new Date() },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', productId: PROD_A, url: '', alt: null, position: 2, createdAt: new Date() },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', productId: PROD_B, url: '', alt: null, position: 0, createdAt: new Date() },
  ];
  dbState.audit = [];
});

describe('POST /api/images/reorder/:productId', () => {
  it('happy path: re-orders 3 images', async () => {
    const app = buildApp();
    const res = await app.request(`/api/images/reorder/${PROD_A}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', position: 2 },
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', position: 0 },
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', position: 1 },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const a1 = dbState.productImages.find((r) => r.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
    const a2 = dbState.productImages.find((r) => r.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
    const a3 = dbState.productImages.find((r) => r.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
    expect(a1?.position).toBe(2);
    expect(a2?.position).toBe(0);
    expect(a3?.position).toBe(1);

    expect(dbState.audit).toHaveLength(1);
  });

  it('404 when one of the ids is unknown', async () => {
    const app = buildApp();
    const res = await app.request(`/api/images/reorder/${PROD_A}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', position: 0 },
          { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', position: 1 }, // unknown
        ],
      }),
    });
    expect(res.status).toBe(404);
  });

  it('400 when image belongs to a different product', async () => {
    const app = buildApp();
    const res = await app.request(`/api/images/reorder/${PROD_A}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', position: 0 },
          { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', position: 1 }, // wrong product
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('400 when items array is empty', async () => {
    const app = buildApp();
    const res = await app.request(`/api/images/reorder/${PROD_A}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('400 when productId is not a UUID', async () => {
    const app = buildApp();
    const res = await app.request(`/api/images/reorder/garbage-id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', position: 0 }] }),
    });
    expect(res.status).toBe(400);
  });
});
