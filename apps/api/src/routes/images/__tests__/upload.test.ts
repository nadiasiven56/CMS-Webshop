/**
 * Upload-route tests.
 *
 * We mocken `lib/db.js` (geen echte Postgres in unit-tests) en
 * `lib/storage/index.js` (in-memory driver). Het auth-middleware mocken we
 * zo dat alle requests een vaste user binnenkrijgen.
 *
 * Doel: code-paden in routes/images/index.ts dekken zonder DB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── mocks: db ───────────────────────────────────────────────
const dbState = {
  productImages: [] as Array<{
    id: string;
    productId: string;
    url: string;
    alt: string | null;
    position: number;
    createdAt: Date;
  }>,
  products: [] as Array<{ id: string }>,
  audit: [] as Array<unknown>,
};

let nextUuidCounter = 0;
function nextUuid(): string {
  nextUuidCounter++;
  return `00000000-0000-4000-8000-${String(nextUuidCounter).padStart(12, '0')}`;
}

// Drizzle-fluent-builder mock — supports the call shapes used in the route.
// Each `db.<method>(table)...` call returns a thenable / chainable object.
function makeFluent(initial: unknown) {
  const ctx: { table?: 'productImages' | 'products' | 'audit'; values?: unknown; where?: unknown } = {};

  const obj: Record<string, unknown> = {};

  obj.from = (t: unknown) => {
    ctx.table = (t as { __name: typeof ctx.table }).__name;
    return obj;
  };
  obj.where = () => obj;
  obj.limit = () => {
    if (initial === 'select-products') return Promise.resolve(dbState.products);
    if (initial === 'select-images') return Promise.resolve(dbState.productImages);
    return Promise.resolve([]);
  };
  obj.values = (v: unknown) => {
    ctx.values = v;
    return obj;
  };
  obj.returning = () => {
    if (initial === 'insert-image') {
      const v = ctx.values as {
        productId: string;
        url: string;
        alt: string | null;
        position: number;
      };
      const row = {
        id: nextUuid(),
        productId: v.productId,
        url: v.url,
        alt: v.alt,
        position: v.position,
        createdAt: new Date(),
      };
      dbState.productImages.push(row);
      return Promise.resolve([row]);
    }
    if (initial === 'update-image') {
      // ctx.values has partial fields; we already mutated dbState in `set()`
      const result = (ctx as unknown as { __resultRow?: unknown }).__resultRow;
      return Promise.resolve(result ? [result] : []);
    }
    return Promise.resolve([]);
  };
  obj.set = (patch: Record<string, unknown>) => {
    if (initial === 'update-image') {
      // ctx.where carries the id selector; for the test we naively scan.
      const target = (ctx.where as { __id?: string })?.__id;
      const row = dbState.productImages.find((r) => r.id === target);
      if (row) {
        Object.assign(row, patch);
        (ctx as unknown as { __resultRow?: unknown }).__resultRow = row;
      }
    }
    return obj;
  };
  // for select.from(images).where().limit() pattern returning a Promise<rows>:
  // we pass through `where()`, then either `.limit()` or direct await.
  (obj as any).then = (resolve: (v: unknown) => unknown) => {
    if (initial === 'select-images-where') {
      return Promise.resolve(dbState.productImages).then(resolve);
    }
    return Promise.resolve([]).then(resolve);
  };
  return obj;
}

// Tag tables so the fluent-builder knows which collection.
vi.mock('../../../db/schema/products.js', () => ({
  products: { __name: 'products' as const },
}));
vi.mock('../../../db/schema/product-images.js', () => ({
  productImages: { __name: 'productImages' as const, id: 'id', productId: 'productId', position: 'position' },
}));
vi.mock('../../../db/schema/audit-log.js', () => ({
  auditLog: { __name: 'audit' as const },
}));

vi.mock('../../../lib/db.js', () => {
  const recordedAudit: unknown[] = [];

  const select = (cols?: unknown) => {
    let table: 'productImages' | 'products' | undefined;
    let limited = false;
    let whereId: string | undefined;
    // Detect aggregation: select({ maxPos: ... }) — return computed max(position).
    const isMaxPosQuery =
      typeof cols === 'object' && cols !== null && 'maxPos' in (cols as Record<string, unknown>);

    const chain = {
      from(t: { __name: 'productImages' | 'products' }) {
        table = t.__name;
        return chain;
      },
      where(predicate: unknown) {
        // Captured eq() returns { __id: value }
        const p = predicate as { __id?: string };
        if (p && p.__id) whereId = p.__id;
        return chain;
      },
      limit(_n: number) {
        limited = true;
        return chain;
      },
      then(resolve: (v: unknown) => unknown) {
        if (isMaxPosQuery && table === 'productImages') {
          const filtered = whereId
            ? dbState.productImages.filter((r) => r.productId === whereId)
            : dbState.productImages;
          const maxPos = filtered.length === 0
            ? -1
            : Math.max(...filtered.map((r) => r.position));
          return Promise.resolve([{ maxPos }]).then(resolve);
        }
        let rows: unknown[] = [];
        if (table === 'productImages') {
          rows = whereId
            ? dbState.productImages.filter((r) => r.id === whereId || r.productId === whereId)
            : dbState.productImages;
        } else if (table === 'products') {
          rows = whereId ? dbState.products.filter((r) => r.id === whereId) : dbState.products;
        }
        if (limited) rows = rows.slice(0, 1);
        return Promise.resolve(rows).then(resolve);
      },
    };
    return chain;
  };

  const insert = (t: { __name: string }) => ({
    values(v: unknown) {
      if (t.__name === 'productImages') {
        const row = {
          id: nextUuid(),
          productId: (v as { productId: string }).productId,
          url: (v as { url: string }).url,
          alt: (v as { alt: string | null }).alt ?? null,
          position: (v as { position: number }).position ?? 0,
          createdAt: new Date(),
        };
        return {
          returning() {
            dbState.productImages.push(row);
            return Promise.resolve([row]);
          },
          then(r: (v: unknown) => unknown) {
            dbState.productImages.push(row);
            return Promise.resolve(undefined).then(r);
          },
        };
      }
      if (t.__name === 'audit') {
        recordedAudit.push(v);
        dbState.audit.push(v);
        return {
          then(r: (v: unknown) => unknown) {
            return Promise.resolve(undefined).then(r);
          },
        };
      }
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
      where(predicate: unknown) {
        whereId = (predicate as { __id?: string })?.__id;
        return chain;
      },
      returning() {
        if (t.__name === 'productImages') {
          const row = dbState.productImages.find((r) => r.id === whereId);
          if (row) Object.assign(row, patch);
          return Promise.resolve(row ? [row] : []);
        }
        return Promise.resolve([]);
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

  const del = (t: { __name: string }) => {
    let whereId: string | undefined;
    const chain = {
      where(predicate: unknown) {
        whereId = (predicate as { __id?: string })?.__id;
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

  const transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ insert, update, delete: del, select });
  };

  const db = {
    select,
    insert,
    update,
    delete: del,
    transaction,
  };

  return { db, schema: {} };
});

// drizzle-orm helpers used in the route — capture as marker objects
vi.mock('drizzle-orm', async () => {
  return {
    eq: (_col: unknown, val: unknown) => ({ __id: val }),
    inArray: (_col: unknown, vals: unknown[]) => ({ __ids: vals }),
    sql: ((..._a: unknown[]) => ({ __sql: true })) as unknown,
  };
});

// storage mock — in-memory driver
const storageState = {
  files: new Map<string, Buffer>(),
  putCalls: [] as Array<{ key: string; size: number; contentType: string }>,
  deleteCalls: [] as string[],
  /** When >0 each put() decrements; put() throws when the counter reaches the failOnCall index. */
  failOnCall: -1,
  callIndex: 0,
};

vi.mock('../../../lib/storage/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/storage/sanitize.js')>(
    '../../../lib/storage/sanitize.js',
  );
  return {
    ...actual,
    getStorage: () => ({
      put: async (key: string, data: Buffer, contentType: string) => {
        storageState.callIndex++;
        if (storageState.callIndex === storageState.failOnCall) {
          throw new Error('mock put failure');
        }
        storageState.files.set(key, data);
        storageState.putCalls.push({ key, size: data.byteLength, contentType });
        return { key, url: `http://test/storage/${key}`, size: data.byteLength };
      },
      delete: async (key: string) => {
        storageState.deleteCalls.push(key);
        storageState.files.delete(key);
      },
      publicUrl: (key: string) => `http://test/storage/${key}`,
    }),
  };
});

// Auth mock — always returns a fixed user.
vi.mock('../../../middleware/auth.js', () => ({
  requireAuth: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('user', { id: 'user-test-1', email: 'admin@test', role: 'admin' });
    await next();
  },
}));

// Logger mock — silent.
vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Now import the route — AFTER all mocks are registered.
const { imageRoutes } = await import('../index.js');
const { Hono } = await import('hono');

function buildApp() {
  const app = new Hono();
  app.route('/api/images', imageRoutes);
  return app;
}

function fakeFile(name: string, type: string, content: string | Buffer): File {
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  return new File([buf], name, { type });
}

beforeEach(() => {
  dbState.productImages = [];
  dbState.products = [{ id: '11111111-1111-4111-8111-111111111111' }];
  dbState.audit = [];
  storageState.files.clear();
  storageState.putCalls = [];
  storageState.deleteCalls = [];
  storageState.failOnCall = -1;
  storageState.callIndex = 0;
  nextUuidCounter = 0;
});

describe('POST /api/images — happy path with productId', () => {
  it('writes file to storage + DB-row + audit', async () => {
    const app = buildApp();
    const fd = new FormData();
    fd.set('file', fakeFile('Cool Photo.jpg', 'image/jpeg', 'image-bytes'));
    fd.set('product_id', '11111111-1111-4111-8111-111111111111');
    fd.set('alt', 'Cool product');

    const res = await app.request('/api/images', {
      method: 'POST',
      body: fd,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.images).toHaveLength(1);
    expect(body.images[0].id).toBeTruthy();
    expect(body.images[0].alt).toBe('Cool product');
    expect((body.images[0].url as string).startsWith('http://test/storage/images/products/')).toBe(true);

    // Storage written
    expect(storageState.putCalls).toHaveLength(1);
    expect(storageState.putCalls[0]!.contentType).toBe('image/jpeg');

    // DB has 1 row
    expect(dbState.productImages).toHaveLength(1);
    // Audit-log written
    expect(dbState.audit.length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/images — losse upload (geen product_id)', () => {
  it('writes file + returns URL maar geen DB-row', async () => {
    const app = buildApp();
    const fd = new FormData();
    fd.set('file', fakeFile('loose.png', 'image/png', 'png-bytes'));

    const res = await app.request('/api/images', { method: 'POST', body: fd });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.images).toHaveLength(1);
    expect(body.images[0].id).toBe(null);
    expect((body.images[0].url as string).startsWith('http://test/storage/images/loose/')).toBe(true);
    expect(dbState.productImages).toHaveLength(0);
  });
});

describe('POST /api/images — invalid content-type', () => {
  it('rejects gif with 415', async () => {
    const app = buildApp();
    const fd = new FormData();
    fd.set('file', fakeFile('anim.gif', 'image/gif', 'g'));

    const res = await app.request('/api/images', { method: 'POST', body: fd });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unsupported_media_type');
    expect(storageState.putCalls).toHaveLength(0);
  });
});

describe('POST /api/images — file too large', () => {
  it('rejects > 10 MB with 413', async () => {
    const app = buildApp();
    const fd = new FormData();
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 0xff);
    fd.set('file', fakeFile('big.jpg', 'image/jpeg', huge));

    const res = await app.request('/api/images', { method: 'POST', body: fd });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('payload_too_large');
    expect(storageState.putCalls).toHaveLength(0);
  });
});

describe('POST /api/images — no file field', () => {
  it('returns 400', async () => {
    const app = buildApp();
    const fd = new FormData();
    fd.set('alt', 'oops');
    const res = await app.request('/api/images', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('no_file');
  });
});

describe('POST /api/images — invalid product_id format', () => {
  it('returns 400', async () => {
    const app = buildApp();
    const fd = new FormData();
    fd.set('file', fakeFile('a.png', 'image/png', 'x'));
    fd.set('product_id', 'not-a-uuid');
    const res = await app.request('/api/images', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_product_id');
  });
});

describe('POST /api/images — product_id niet gevonden', () => {
  it('returns 404', async () => {
    dbState.products = []; // no products
    const app = buildApp();
    const fd = new FormData();
    fd.set('file', fakeFile('a.png', 'image/png', 'x'));
    fd.set('product_id', '99999999-9999-4999-8999-999999999999');
    const res = await app.request('/api/images', { method: 'POST', body: fd });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/images — storage failure cleans up partial uploads', () => {
  it('deletes earlier-uploaded files when later one fails', async () => {
    // Make the 2nd put() throw → 1st succeeds, route should rollback by deleting it.
    storageState.failOnCall = 2;

    const app = buildApp();
    const fd = new FormData();
    fd.append('file', fakeFile('a.jpg', 'image/jpeg', 'aaa'));
    fd.append('file', fakeFile('b.jpg', 'image/jpeg', 'bbb'));

    const res = await app.request('/api/images', { method: 'POST', body: fd });
    expect(res.status).toBe(500);
    // 1 file successfully put, then rolled-back via storage.delete():
    expect(storageState.putCalls).toHaveLength(1);
    expect(storageState.deleteCalls.length).toBeGreaterThanOrEqual(1);
  });
});
