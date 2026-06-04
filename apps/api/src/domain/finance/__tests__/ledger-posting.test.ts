/**
 * Unit-tests voor ledger-posting.
 *
 * Strategie: een in-memory fake `tx` die `insert().values()`, `select()` en
 * `delete().returning()` ondersteunt en de ingevoegde rijen vasthoudt. We
 * inspecteren de rijen en asserteren dat sum(debit) === sum(credit) in centen
 * (gebalanceerde boeking) + de idempotency-guard.
 *
 * We mocken `drizzle-orm`'s `eq`/`and` naar plain expression-objecten en
 * vertalen die in de fake-`where` naar een predicate op onze FakeRow — zo
 * hoeven we geen echte Postgres te draaien.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

beforeAll(() => {
  // env-validatie tevreden houden (db/logger importeren env via ledger-posting).
  if (!process.env.CHANNEL_SECRET_KEY || process.env.CHANNEL_SECRET_KEY.length < 32) {
    process.env.CHANNEL_SECRET_KEY = 'test-channel-secret-key-0123456789abcdef';
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    process.env.SESSION_SECRET = 'test-session-secret-key-0123456789abcdef';
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgres://localhost:7432/webshop_crm_test';
  }
});

// Drizzle's eq/and produceren SQL-objects. We vervangen ze door plain objecten
// die onze fake-where kan interpreteren.
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __op: 'eq', col, val }),
  and: (...preds: unknown[]) => ({ __op: 'and', preds }),
}));

const { postOrderRevenue, postRefund, reverseOrderLedger, LEDGER_ACCOUNTS } =
  await import('../ledger-posting.js');
const { toCents } = await import('../vat-math.js');

// ─── In-memory fake tx ────────────────────────────────────────

interface FakeRow {
  account: string;
  debit: string;
  credit: string;
  orderId: string | null;
  [k: string]: unknown;
}

type Expr =
  | { __op: 'eq'; col: { name?: string }; val: unknown }
  | { __op: 'and'; preds: Expr[] }
  | undefined;

function predicateFromExpr(expr: Expr): (r: FakeRow) => boolean {
  if (!expr) return () => true;
  if (expr.__op === 'and') {
    const ps = expr.preds.map(predicateFromExpr);
    return (r) => ps.every((p) => p(r));
  }
  // eq
  const colStr = String(expr.col?.name ?? expr.col);
  const field = colStr.includes('account')
    ? 'account'
    : colStr.includes('order')
      ? 'orderId'
      : null;
  return (r) => {
    if (field === 'account') return r.account === expr.val;
    if (field === 'orderId') return r.orderId === expr.val;
    return true;
  };
}

function makeFakeTx() {
  const rows: FakeRow[] = [];
  const tx = {
    insert(_table: unknown) {
      return {
        values(vals: FakeRow | FakeRow[]) {
          rows.push(...(Array.isArray(vals) ? vals : [vals]));
          return Promise.resolve();
        },
      };
    },
    select(_proj?: unknown) {
      return {
        from(_table: unknown) {
          return {
            where(expr: Expr) {
              const pred = predicateFromExpr(expr);
              return {
                limit(n: number) {
                  return Promise.resolve(rows.filter(pred).slice(0, n));
                },
              };
            },
          };
        },
      };
    },
    delete(_table: unknown) {
      return {
        where(expr: Expr) {
          const pred = predicateFromExpr(expr);
          return {
            returning(_p?: unknown) {
              const removed = rows.filter(pred);
              for (const r of removed) {
                const idx = rows.indexOf(r);
                if (idx >= 0) rows.splice(idx, 1);
              }
              return Promise.resolve(removed.map(() => ({ id: 'x' })));
            },
          };
        },
      };
    },
  };
  return { tx: tx as never, rows };
}

// ─── Sample-data ──────────────────────────────────────────────

const SHOP_ID = '00000000-0000-4000-8000-000000000051';
const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';

function sampleOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    shopId: SHOP_ID,
    channel: 'web',
    currency: 'EUR',
    subtotal: '100.0000', // netto
    taxTotal: '21.0000', // 21% BTW
    grandTotal: '121.0000',
    placedAt: new Date('2026-05-10T12:00:00Z'),
    createdAt: new Date('2026-05-10T12:00:00Z'),
    ...overrides,
  } as never;
}

function sampleItems() {
  return [
    { quantity: 2, costPrice: '20.0000', taxRate: '21.00' }, // cogs 40
    { quantity: 1, costPrice: '15.0000', taxRate: '21.00' }, // cogs 15
  ] as never[];
}

function sumCents(rows: FakeRow[]) {
  let debit = 0;
  let credit = 0;
  for (const r of rows) {
    debit += toCents(r.debit);
    credit += toCents(r.credit);
  }
  return { debit, credit };
}

// ─── Tests ────────────────────────────────────────────────────

describe('postOrderRevenue', () => {
  it('writes a balanced set (sum debit === sum credit in cents)', async () => {
    const { tx, rows } = makeFakeTx();
    const written = await postOrderRevenue(tx, sampleOrder(), sampleItems());
    expect(written).toBeGreaterThan(0);

    const orderRows = rows.filter((r) => r.orderId === ORDER_ID);
    const { debit, credit } = sumCents(orderRows);
    expect(debit).toBe(credit);

    // revenue net = 100.00 = 10000 cents, vat = 2100 cents
    const revenue = orderRows.find((r) => r.account === LEDGER_ACCOUNTS.revenue)!;
    expect(toCents(revenue.credit)).toBe(10000);
    const vat = orderRows.find((r) => r.account === LEDGER_ACCOUNTS.vatPayable)!;
    expect(toCents(vat.credit)).toBe(2100);
    // cogs = 2*20 + 1*15 = 55.00 = 5500 cents
    const cogs = orderRows.find((r) => r.account === LEDGER_ACCOUNTS.cogs)!;
    expect(toCents(cogs.debit)).toBe(5500);
  });

  it('is idempotent: a second call writes nothing', async () => {
    const { tx, rows } = makeFakeTx();
    await postOrderRevenue(tx, sampleOrder(), sampleItems());
    const countAfterFirst = rows.length;
    const written2 = await postOrderRevenue(tx, sampleOrder(), sampleItems());
    expect(written2).toBe(0);
    expect(rows.length).toBe(countAfterFirst);
  });

  it('stays balanced with no cost prices (no cogs block)', async () => {
    const { tx, rows } = makeFakeTx();
    await postOrderRevenue(
      tx,
      sampleOrder(),
      [{ quantity: 1, costPrice: null, taxRate: '21.00' }] as never[],
    );
    const { debit, credit } = sumCents(rows.filter((r) => r.orderId === ORDER_ID));
    expect(debit).toBe(credit);
    expect(rows.find((r) => r.account === LEDGER_ACCOUNTS.cogs)).toBeUndefined();
  });
});

describe('postRefund', () => {
  it('writes a balanced refund set', async () => {
    const { tx, rows } = makeFakeTx();
    const written = await postRefund(tx, sampleOrder(), '60.5000'); // half the order
    expect(written).toBe(3);
    const { debit, credit } = sumCents(rows.filter((r) => r.orderId === ORDER_ID));
    expect(debit).toBe(credit);

    const refund = rows.find((r) => r.account === LEDGER_ACCOUNTS.refund)!;
    expect(toCents(refund.credit)).toBe(6050);
    // net + vat debit must equal the gross refund credit
    const net = rows.find((r) => r.account === LEDGER_ACCOUNTS.revenue)!;
    const vat = rows.find((r) => r.account === LEDGER_ACCOUNTS.vatPayable)!;
    expect(toCents(net.debit) + toCents(vat.debit)).toBe(6050);
  });

  it('returns 0 for a zero/negative refund', async () => {
    const { tx } = makeFakeTx();
    expect(await postRefund(tx, sampleOrder(), '0.0000')).toBe(0);
  });
});

describe('reverseOrderLedger', () => {
  it('removes all entries for an order', async () => {
    const { tx, rows } = makeFakeTx();
    await postOrderRevenue(tx, sampleOrder(), sampleItems());
    const before = rows.filter((r) => r.orderId === ORDER_ID).length;
    expect(before).toBeGreaterThan(0);
    const removed = await reverseOrderLedger(tx, ORDER_ID);
    expect(removed).toBe(before);
    expect(rows.filter((r) => r.orderId === ORDER_ID).length).toBe(0);
  });
});
