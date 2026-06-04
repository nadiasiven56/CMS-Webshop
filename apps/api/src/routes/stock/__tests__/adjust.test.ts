/**
 * Route-level tests voor `POST /api/stock/:itemId/adjust`.
 *
 * Strategie: mock `db` + `requireAuth` + `runInTransactionWithAudit` zodat we
 * de Hono-handler kunnen testen zonder Postgres. Dekt:
 *   - happy-path adjust positief → 200 + level updated
 *   - happy-path adjust negatief → 200 + level updated
 *   - error: ongeldig item_id → 404
 *   - error: ongeldige location_id → 404
 *   - error: negative-result → 422
 *   - error: invalid body (delta=0, geen reason) → 400
 *
 * Echte Postgres-integration komt in V1-finalize via testcontainers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NegativeStockError } from '../../../domain/stock/available-recompute.js';

// ─── Mocks moeten VOOR de route-import gehoist worden ────────

const mockState = {
  itemExists: true,
  locationExists: true,
  locationActive: true,
  shouldThrowNegative: false,
};

vi.mock('../../../lib/db.js', () => {
  // Minimal `db` mock die alleen de existence-check-queries serveert die
  // de route-handler doet (item+location lookup voor pre-check).
  const selectMock = vi.fn(() => ({
    from(table: unknown) {
      return {
        where(_p: unknown) {
          return {
            async limit(_n: number) {
              // drizzle-orm exposes the table name via the
              // `Symbol.for('drizzle:Name')` symbol; `String(table)` is just
              // "[object Object]" and never contains the table name.
              const tableStr =
                (table as Record<symbol, unknown>)?.[Symbol.for('drizzle:Name')] != null
                  ? String((table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')])
                  : String(table);
              if (tableStr.includes('inventory_items')) {
                return mockState.itemExists
                  ? [{ id: '00000000-0000-4000-8000-000000000001' }]
                  : [];
              }
              if (tableStr.includes('locations')) {
                return mockState.locationExists
                  ? [
                      {
                        id: '00000000-0000-4000-8000-000000000002',
                        active: mockState.locationActive,
                      },
                    ]
                  : [];
              }
              return [];
            },
          };
        },
      };
    },
  }));

  return {
    db: { select: selectMock } as never,
    schema: {},
  };
});

vi.mock('../../../middleware/auth.js', () => {
  return {
    requireAuth: async (c: any, next: any) => {
      c.set('user', {
        id: '00000000-0000-4000-8000-000000000099',
        email: 'test@example.com',
        role: 'admin',
      });
      await next();
    },
  };
});

// Mock runInTransactionWithAudit zodat de echte db.transaction() niet wordt
// aangeroepen. De fake-tx levert de route's `tx.insert(inventoryMovements)`
// een returning-stub.
vi.mock('../../../domain/stock/transaction-helpers.js', () => {
  return {
    runInTransactionWithAudit: vi.fn(async (work: any) => {
      const fakeTx = {
        insert: () => ({
          values: () => ({
            async returning() {
              return [
                {
                  id: '00000000-0000-4000-8000-0000000000aa',
                  delta: 0,
                  reason: 'manual',
                  createdAt: new Date('2026-05-09T14:00:00Z'),
                },
              ];
            },
          }),
        }),
      };
      const builder = {
        entry: undefined as unknown,
        set(e: unknown) {
          this.entry = e;
        },
      };
      if (mockState.shouldThrowNegative) {
        throw new NegativeStockError(
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
          2,
          -5,
        );
      }
      return work(fakeTx, builder);
    }),
    writeAudit: vi.fn(),
    AuditBuilder: class {
      entry: unknown;
      set(e: unknown) {
        this.entry = e;
      }
    },
  };
});

// Mock applyDeltaAndRecompute — geeft consistent een snapshot terug op basis
// van de delta. We exporteren NegativeStockError uit de actual-module zodat
// `instanceof` blijft werken in de route-handler.
vi.mock('../../../domain/stock/available-recompute.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../domain/stock/available-recompute.js')
  >('../../../domain/stock/available-recompute.js');
  return {
    ...actual,
    applyDeltaAndRecompute: vi.fn(async (_tx: unknown, input: { delta: number }) => ({
      itemId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
      onHand: 10 + input.delta,
      available: 10 + input.delta,
      committed: 0,
      incoming: 0,
      minStock: null,
      reorderPoint: null,
      reorderQty: null,
    })),
  };
});

// ─── Route import (na alle mocks) ────────────────────────────

const { stockRoutes } = await import('../index.js');

// ─── Test-helpers ────────────────────────────────────────────

const ITEM_ID = '00000000-0000-4000-8000-000000000001';
const LOC_ID = '00000000-0000-4000-8000-000000000002';

function setSession(): { cookie: string } {
  // requireAuth is gemockt; we sturen een dummy-cookie zodat eventuele
  // cookie-parsers niet kuchen.
  return { cookie: 'webshop_crm_session=fake' };
}

async function callAdjust(
  itemId: string,
  body: unknown,
  query?: string,
): Promise<{ status: number; body: any }> {
  const url = `http://localhost/${itemId}/adjust${query ? `?${query}` : ''}`;
  const res = await stockRoutes.request(url, {
    method: 'POST',
    headers: { ...setSession(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

beforeEach(() => {
  mockState.itemExists = true;
  mockState.locationExists = true;
  mockState.locationActive = true;
  mockState.shouldThrowNegative = false;
});

// ─── Tests ──────────────────────────────────────────────────

describe('POST /api/stock/:itemId/adjust', () => {
  it('happy-path: positive delta returns 200 with updated level', async () => {
    const { status, body } = await callAdjust(ITEM_ID, {
      location_id: LOC_ID,
      delta: 5,
      reason: 'receive',
      note: 'PO arrived',
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.level.onHand).toBe(15);
    expect(body.level.available).toBe(15);
    expect(body.movement?.id).toBe('00000000-0000-4000-8000-0000000000aa');
  });

  it('happy-path: negative delta returns 200 with decremented level', async () => {
    const { status, body } = await callAdjust(ITEM_ID, {
      location_id: LOC_ID,
      delta: -3,
      reason: 'damage',
    });
    expect(status).toBe(200);
    expect(body.level.onHand).toBe(7);
    expect(body.level.available).toBe(7);
  });

  it('returns 404 when item_id does not exist', async () => {
    mockState.itemExists = false;
    const { status, body } = await callAdjust(ITEM_ID, {
      location_id: LOC_ID,
      delta: 1,
      reason: 'manual',
    });
    expect(status).toBe(404);
    expect(body.error).toBe('item_not_found');
  });

  it('returns 404 when location_id does not exist', async () => {
    mockState.locationExists = false;
    const { status, body } = await callAdjust(ITEM_ID, {
      location_id: LOC_ID,
      delta: 1,
      reason: 'manual',
    });
    expect(status).toBe(404);
    expect(body.error).toBe('location_not_found');
  });

  it('returns 422 when location is inactive', async () => {
    mockState.locationActive = false;
    const { status, body } = await callAdjust(ITEM_ID, {
      location_id: LOC_ID,
      delta: 1,
      reason: 'manual',
    });
    expect(status).toBe(422);
    expect(body.error).toBe('location_inactive');
  });

  it('returns 422 when adjustment would create negative on_hand', async () => {
    mockState.shouldThrowNegative = true;
    const { status, body } = await callAdjust(ITEM_ID, {
      location_id: LOC_ID,
      delta: -5,
      reason: 'damage',
    });
    expect(status).toBe(422);
    expect(body.error).toBe('negative_stock');
    expect(body.currentOnHand).toBe(2);
    expect(body.delta).toBe(-5);
  });

  it('returns 400 for invalid request body (delta=0)', async () => {
    const { status, body } = await callAdjust(ITEM_ID, {
      location_id: LOC_ID,
      delta: 0,
      reason: 'manual',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 for missing reason', async () => {
    const { status, body } = await callAdjust(ITEM_ID, {
      location_id: LOC_ID,
      delta: 5,
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 for invalid item_id format', async () => {
    const { status, body } = await callAdjust('not-a-uuid', {
      location_id: LOC_ID,
      delta: 5,
      reason: 'manual',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_item_id');
  });

  it('returns 400 for invalid location_id format', async () => {
    const { status, body } = await callAdjust(ITEM_ID, {
      location_id: 'not-a-uuid',
      delta: 5,
      reason: 'manual',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_request');
  });
});
