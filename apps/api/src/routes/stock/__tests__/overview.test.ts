/**
 * Schema-validation tests voor `GET /api/stock` query.
 *
 * Het echte SQL-aggregatiepad heeft een echte Postgres nodig (komt in
 * V1-finalize via testcontainers). Deze tests dekken de query-validatie en
 * de Hono-handler-shape door db-calls te mocken.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────

const mockResult = {
  rows: [] as Array<{
    itemId: string;
    sku: string;
    tracked: boolean;
    variantId: string | null;
    variantSku: string | null;
    productId: string | null;
    productTitle: string | null;
    productStatus: string | null;
    onHandTotal: number;
    availableTotal: number;
    committedTotal: number;
    incomingTotal: number;
    locationsCount: number;
    lowStock: boolean;
  }>,
  total: 0,
};

vi.mock('../../../lib/db.js', () => {
  // Build a chainable select-mock dat aan het eind de mockResult.rows teruggeeft.
  // Drizzle gebruikt thenable + dynamic — we maken een object dat de hele
  // chain "doorlaat" en als het ge-await wordt, mockResult.rows teruggeeft.
  function makeChain(isCount: boolean): any {
    const chain: any = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            // Awaitable: return mockResult
            return (resolve: (v: unknown) => void) => {
              if (isCount) resolve([{ total: mockResult.total }]);
              else resolve(mockResult.rows);
            };
          }
          // Any chain method returns the same chain
          return (..._args: unknown[]) => chain;
        },
      },
    );
    return chain;
  }

  const select = vi.fn((cols?: { total?: unknown }) => {
    // Detect of dit de count-query is via aanwezigheid van `total`-veld
    const isCount = !!cols && Object.keys(cols).includes('total');
    return makeChain(isCount);
  });

  return {
    db: { select } as never,
    schema: {},
  };
});

vi.mock('../../../middleware/auth.js', () => ({
  requireAuth: async (c: any, next: any) => {
    c.set('user', {
      id: '00000000-0000-4000-8000-000000000099',
      email: 'test@example.com',
      role: 'admin',
    });
    await next();
  },
}));

const { stockRoutes } = await import('../index.js');

async function callOverview(query?: string): Promise<{ status: number; body: any }> {
  const url = `http://localhost/${query ? `?${query}` : ''}`;
  const res = await stockRoutes.request(url, {
    method: 'GET',
    headers: { cookie: 'webshop_crm_session=fake' },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

beforeEach(() => {
  mockResult.rows = [];
  mockResult.total = 0;
});

// ─── Tests ──────────────────────────────────────────────────

describe('GET /api/stock', () => {
  it('returns empty list with valid pagination defaults', async () => {
    mockResult.rows = [];
    mockResult.total = 0;
    const { status, body } = await callOverview();
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.total).toBe(0);
  });

  it('returns rows with aggregated totals', async () => {
    mockResult.rows = [
      {
        itemId: '00000000-0000-4000-8000-000000000001',
        sku: 'SKU-A',
        tracked: true,
        variantId: '00000000-0000-4000-8000-000000000010',
        variantSku: 'SKU-A',
        productId: '00000000-0000-4000-8000-000000000011',
        productTitle: 'Product A',
        productStatus: 'active',
        onHandTotal: 25,
        availableTotal: 22,
        committedTotal: 3,
        incomingTotal: 5,
        locationsCount: 2,
        lowStock: false,
      },
      {
        itemId: '00000000-0000-4000-8000-000000000002',
        sku: 'SKU-B',
        tracked: true,
        variantId: '00000000-0000-4000-8000-000000000020',
        variantSku: 'SKU-B',
        productId: '00000000-0000-4000-8000-000000000021',
        productTitle: 'Product B',
        productStatus: 'active',
        onHandTotal: 1,
        availableTotal: 1,
        committedTotal: 0,
        incomingTotal: 0,
        locationsCount: 1,
        lowStock: true,
      },
    ];
    mockResult.total = 2;

    const { status, body } = await callOverview();
    expect(status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].sku).toBe('SKU-A');
    expect(body.items[0].onHandTotal).toBe(25);
    expect(body.items[0].availableTotal).toBe(22);
    expect(body.items[0].locationsCount).toBe(2);
    expect(body.items[0].lowStock).toBe(false);
    expect(body.items[1].lowStock).toBe(true);
    expect(body.total).toBe(2);
  });

  it('accepts search parameter', async () => {
    mockResult.rows = [];
    mockResult.total = 0;
    const { status } = await callOverview('search=SKU-A');
    expect(status).toBe(200);
  });

  it('accepts sort parameter', async () => {
    const { status } = await callOverview('sort=available_desc');
    expect(status).toBe(200);
  });

  it('accepts lowStockOnly filter', async () => {
    const { status } = await callOverview('lowStockOnly=true');
    expect(status).toBe(200);
  });

  it('returns 400 on invalid sort value', async () => {
    const { status, body } = await callOverview('sort=banana');
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 on invalid pageSize (out of range)', async () => {
    const { status, body } = await callOverview('pageSize=9999');
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_request');
  });

  it('respects custom page + pageSize', async () => {
    mockResult.rows = [];
    mockResult.total = 100;
    const { status, body } = await callOverview('page=3&pageSize=20');
    expect(status).toBe(200);
    expect(body.page).toBe(3);
    expect(body.pageSize).toBe(20);
    expect(body.total).toBe(100);
  });
});
