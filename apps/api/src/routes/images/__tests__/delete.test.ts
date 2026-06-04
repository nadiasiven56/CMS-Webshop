/**
 * DELETE /api/images/:id route tests.
 * Reuses the same in-memory mock setup style as upload.test.ts.
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

vi.mock('../../../lib/db.js', () => {
  const select = () => {
    let table: string | undefined;
    let whereId: string | undefined;
    const chain = {
      from(t: { __name: string }) {
        table = t.__name;
        return chain;
      },
      where(p: { __id?: string }) {
        whereId = p?.__id;
        return chain;
      },
      limit() {
        return chain;
      },
      then(r: (v: unknown) => unknown) {
        const rows =
          table === 'productImages'
            ? dbState.productImages.filter((row) => row.id === whereId)
            : [];
        return Promise.resolve(rows).then(r);
      },
    };
    return chain;
  };

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

  const del = (t: { __name: string }) => {
    let whereId: string | undefined;
    const chain = {
      where(p: { __id?: string }) {
        whereId = p?.__id;
        return chain;
      },
      then(r: (v: unknown) => unknown) {
        if (t.__name === 'productImages') {
          dbState.productImages = dbState.productImages.filter((row) => row.id !== whereId);
        }
        return Promise.resolve(undefined).then(r);
      },
    };
    return chain;
  };

  return { db: { select, insert, delete: del }, schema: {} };
});

vi.mock('drizzle-orm', () => ({
  eq: (_c: unknown, v: unknown) => ({ __id: v }),
  inArray: (_c: unknown, v: unknown[]) => ({ __ids: v }),
  sql: (..._a: unknown[]) => ({ __sql: true }),
}));

const storageDeletes: string[] = [];
let nextDeleteThrows = false;

vi.mock('../../../lib/storage/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/storage/sanitize.js')>(
    '../../../lib/storage/sanitize.js',
  );
  return {
    ...actual,
    getStorage: () => ({
      put: async () => ({ key: '', url: '', size: 0 }),
      delete: async (key: string) => {
        storageDeletes.push(key);
        if (nextDeleteThrows) {
          nextDeleteThrows = false;
          throw new Error('disk full');
        }
      },
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

beforeEach(() => {
  dbState.productImages = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      productId: '11111111-1111-4111-8111-111111111111',
      url: 'http://localhost:7300/storage/images/products/p1/abc-photo.jpg',
      alt: 'cool',
      position: 0,
      createdAt: new Date(),
    },
  ];
  dbState.audit = [];
  storageDeletes.length = 0;
  nextDeleteThrows = false;
});

describe('DELETE /api/images/:id', () => {
  it('happy path: removes DB-row, deletes file, writes audit', async () => {
    const app = buildApp();
    const res = await app.request('/api/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(dbState.productImages).toHaveLength(0);
    expect(storageDeletes).toEqual(['images/products/p1/abc-photo.jpg']);
    expect(dbState.audit).toHaveLength(1);
  });

  it('404 when id not found', async () => {
    const app = buildApp();
    const res = await app.request('/api/images/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    expect(dbState.productImages).toHaveLength(1);
    expect(storageDeletes).toHaveLength(0);
  });

  it('400 when id not a UUID', async () => {
    const app = buildApp();
    const res = await app.request('/api/images/not-a-uuid', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('still 200 if storage.delete throws (DB row already gone)', async () => {
    nextDeleteThrows = true;
    const app = buildApp();
    const res = await app.request('/api/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(dbState.productImages).toHaveLength(0); // DB consistent
  });
});
