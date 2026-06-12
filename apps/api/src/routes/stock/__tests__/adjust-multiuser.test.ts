/**
 * Multi-user tests voor `POST /api/stock/:itemId/adjust`.
 *
 * Non-admins mogen alleen voorraad van EIGEN producten muteren; andermans
 * (of ongekoppelde/platform-) items gedragen zich als onbestaand → 404
 * `item_not_found` (zelfde shape als bestaand). Admin blijft ongewijzigd.
 *
 * Zelfde mock-strategie als adjust.test.ts, plus een leftJoin-aware select
 * voor de ownership-query (inventory_items -> variants -> products).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ADMIN = { id: '00000000-0000-4000-8000-0000000000ad', email: 'admin@test', role: 'admin' };
const USER_A = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', email: 'a@test', role: 'user' };

const authState = { user: { ...ADMIN } as { id: string; email: string; role: string } };

const mockState = {
  itemExists: true,
  /** Owner van het product achter het item; null = platform-catalogus. */
  ownerUserId: null as string | null,
  ownershipQueries: 0,
};

vi.mock('../../../lib/db.js', () => {
  const select = vi.fn(() => {
    let table = '';
    let joined = false;
    const chain: any = {
      from(t: unknown) {
        const nameSym = (t as Record<symbol, unknown>)?.[Symbol.for('drizzle:Name')];
        table = typeof nameSym === 'string' ? nameSym : '';
        return chain;
      },
      leftJoin() {
        joined = true;
        return chain;
      },
      where() {
        return chain;
      },
      async limit(_n: number) {
        if (table === 'inventory_items' && joined) {
          // Ownership-query (items -> variants -> products)
          mockState.ownershipQueries++;
          return mockState.itemExists ? [{ ownerUserId: mockState.ownerUserId }] : [];
        }
        if (table === 'inventory_items') {
          return mockState.itemExists ? [{ id: '00000000-0000-4000-8000-000000000001' }] : [];
        }
        if (table === 'locations') {
          return [{ id: '00000000-0000-4000-8000-000000000002', active: true }];
        }
        return [];
      },
    };
    return chain;
  });

  return { db: { select } as never, schema: {} };
});

vi.mock('../../../middleware/auth.js', () => ({
  requireAuth: async (c: any, next: any) => {
    c.set('user', authState.user);
    await next();
  },
}));

vi.mock('../../../domain/stock/transaction-helpers.js', () => ({
  runInTransactionWithAudit: vi.fn(async (work: any) => {
    const fakeTx = {
      insert: () => ({
        values: () => ({
          async returning() {
            return [
              {
                id: '00000000-0000-4000-8000-0000000000aa',
                delta: 5,
                reason: 'manual',
                createdAt: new Date('2026-06-12T10:00:00Z'),
              },
            ];
          },
        }),
      }),
    };
    const audit = { set: (_e: unknown) => undefined };
    return work(fakeTx, audit);
  }),
}));

vi.mock('../../../domain/stock/available-recompute.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../domain/stock/available-recompute.js')
  >('../../../domain/stock/available-recompute.js');
  return {
    ...actual,
    applyDeltaAndRecompute: vi.fn(async (_tx: unknown, args: { itemId: string; locationId: string; delta: number }) => ({
      itemId: args.itemId,
      locationId: args.locationId,
      onHand: 5,
      available: 5,
      committed: 0,
      incoming: 0,
    })),
  };
});

vi.mock('../../../lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const { stockRoutes } = await import('../index.js');
const { Hono } = await import('hono');

function buildApp() {
  const app = new Hono();
  app.route('/api/stock', stockRoutes);
  return app;
}

const ITEM_ID = '00000000-0000-4000-8000-000000000001';
const LOCATION_ID = '00000000-0000-4000-8000-000000000002';

function adjustRequest(app: ReturnType<typeof buildApp>) {
  return app.request(`/api/stock/${ITEM_ID}/adjust`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ location_id: LOCATION_ID, delta: 5, reason: 'manual' }),
  });
}

beforeEach(() => {
  authState.user = { ...ADMIN };
  mockState.itemExists = true;
  mockState.ownerUserId = null;
  mockState.ownershipQueries = 0;
});

describe('POST /api/stock/:itemId/adjust — multi-user scoping', () => {
  it("404 item_not_found voor role 'user' op andermans product", async () => {
    authState.user = { ...USER_A };
    mockState.ownerUserId = 'bbbbbbbb-0000-4000-8000-00000000000b';
    const app = buildApp();
    const res = await adjustRequest(app);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('item_not_found');
    expect(mockState.ownershipQueries).toBe(1);
  });

  it("404 voor role 'user' op platform-item (owner = null)", async () => {
    authState.user = { ...USER_A };
    mockState.ownerUserId = null;
    const app = buildApp();
    const res = await adjustRequest(app);
    expect(res.status).toBe(404);
  });

  it("200 voor role 'user' op eigen product", async () => {
    authState.user = { ...USER_A };
    mockState.ownerUserId = USER_A.id;
    const app = buildApp();
    const res = await adjustRequest(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it('200 voor admin zonder ownership-query (ongewijzigd gedrag)', async () => {
    const app = buildApp();
    const res = await adjustRequest(app);
    expect(res.status).toBe(200);
    expect(mockState.ownershipQueries).toBe(0);
  });
});
