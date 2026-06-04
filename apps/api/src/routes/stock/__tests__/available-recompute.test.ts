/**
 * Unit tests voor `applyDeltaAndRecompute` — pure logica met in-memory mock-tx.
 *
 * We mocken het Drizzle-tx-handle als minimal stubs. Dit dekt:
 *   - happy-path positief
 *   - happy-path negatief
 *   - negative-stock weiger
 *   - negative-stock met force toegestaan
 *   - inserteert nieuwe row als (item, location)-paar nog geen level heeft
 *
 * Echte Postgres-integration komt in V1-finalize via testcontainers.
 */
import { describe, it, expect } from 'vitest';
import {
  applyDeltaAndRecompute,
  NegativeStockError,
} from '../../../domain/stock/available-recompute.js';

type MockLevel = {
  itemId: string;
  locationId: string;
  onHand: number;
  available: number;
  committed: number;
  incoming: number;
  minStock: number | null;
  reorderPoint: number | null;
  reorderQty: number | null;
};

/**
 * Bouw een minimale mock van het Drizzle-tx-object met ondersteuning voor
 * `select().from().where().limit()`, `update().set().where().returning()`
 * en `insert().values().returning()`.
 */
function buildMockTx(initial: MockLevel[] = []) {
  const store = new Map<string, MockLevel>(
    initial.map((l) => [`${l.itemId}:${l.locationId}`, { ...l }]),
  );

  // Track filter pair tussen select-calls.
  let pendingItemId: string | null = null;
  let pendingLocationId: string | null = null;

  const selectChain = {
    from: (_table: unknown) => selectChain,
    where: (predicate: { __mockItemId: string; __mockLocationId: string }) => {
      pendingItemId = predicate.__mockItemId;
      pendingLocationId = predicate.__mockLocationId;
      return selectChain;
    },
    limit: async (_n: number) => {
      const key = `${pendingItemId}:${pendingLocationId}`;
      const row = store.get(key);
      pendingItemId = null;
      pendingLocationId = null;
      return row ? [row] : [];
    },
  };

  const updateChain = {
    _itemId: '' as string,
    _locationId: '' as string,
    _set: {} as Partial<MockLevel>,
    set(values: Partial<MockLevel>) {
      this._set = values;
      return this;
    },
    where(predicate: { __mockItemId: string; __mockLocationId: string }) {
      this._itemId = predicate.__mockItemId;
      this._locationId = predicate.__mockLocationId;
      return this;
    },
    async returning() {
      const key = `${this._itemId}:${this._locationId}`;
      const existing = store.get(key);
      if (!existing) return [];
      const updated = { ...existing, ...this._set } as MockLevel;
      store.set(key, updated);
      return [updated];
    },
  };

  const insertChain = {
    _values: null as Partial<MockLevel> | null,
    values(v: Partial<MockLevel>) {
      this._values = v;
      return this;
    },
    async returning() {
      const v = this._values!;
      const row: MockLevel = {
        itemId: v.itemId!,
        locationId: v.locationId!,
        onHand: v.onHand ?? 0,
        available: v.available ?? 0,
        committed: v.committed ?? 0,
        incoming: v.incoming ?? 0,
        minStock: v.minStock ?? null,
        reorderPoint: v.reorderPoint ?? null,
        reorderQty: v.reorderQty ?? null,
      };
      store.set(`${row.itemId}:${row.locationId}`, row);
      return [row];
    },
  };

  return {
    store,
    tx: {
      select: () => ({ ...selectChain }),
      update: (_table: unknown) => ({ ...updateChain }),
      insert: (_table: unknown) => ({ ...insertChain }),
    } as never,
  };
}

// In de echte code wordt `and(eq(...), eq(...))` gebruikt. Onze mock-where
// negeert dat en kijkt naar onze eigen marker — dus we monkey-patchen het
// produceren van predicate via een proxy. Eenvoudiger: we laten the real
// drizzle-helper call doorlopen en intercepten via de SQL-marker. Voor
// deze unit-test is bovenstaand mock al voldoende — we callen functies
// direct die getLevel/etc onder water gebruiken; het ENIGE wat telt is
// dat select+limit -> store.get werkt.
//
// Drizzle's `and(eq(),eq())` retourneert een SQL-object. Onze mock vangt dat
// op via .where(predicate) — we laten dat path gewoon door en voorzien een
// item+location uit de input van de aanroep i.p.v. uit predicate.

// Tweak: we laten applyDeltaAndRecompute direct aanroepen met onze mock.
// Probleem: getLevel filtert op (itemId, locationId) via Drizzle's `and(eq,eq)`.
// Onze mock moet dat tot herkenbare keys mappen. We doen dat door
// select-chain de itemId/locationId uit de gepusste predicate te lezen.
// Concrete fix: monkey-patch select.where om altijd te kijken naar de
// argumenten die we verwachten. We wrapt de mock-tx in een proxy die
// select-chain leest uit de input van applyDeltaAndRecompute via
// thread-local. Voor nu: simpel — we setten pending direct via de input.
//
// Implementatie-keuze: schrijf vervangende functies voor deze test die
// rechtstreeks op store werken zonder Drizzle-dialect te raken. Dit verlaagt
// fideliteit van de test maar dekt wel de business-logic (delta-toepassing,
// negative-check, force-flag). Echte SQL-correctheid komt via integration-test.

describe('applyDeltaAndRecompute (logic)', () => {
  const ITEM = '00000000-0000-4000-8000-000000000001';
  const LOC = '00000000-0000-4000-8000-000000000002';

  it('happy-path: positive delta increases on_hand and recomputes available', async () => {
    const { tx, store } = buildMockTx([
      {
        itemId: ITEM,
        locationId: LOC,
        onHand: 10,
        available: 8,
        committed: 2,
        incoming: 0,
        minStock: 3,
        reorderPoint: null,
        reorderQty: null,
      },
    ]);

    // Force the mock to identify rows by (item, loc) — patch select-chain
    // to use the input itemId + loc. We do this via a proxy on tx.select.
    const txWithRouter = makeTxWithRouter(tx, store, ITEM, LOC);

    const result = await applyDeltaAndRecompute(txWithRouter, {
      itemId: ITEM,
      locationId: LOC,
      delta: 5,
    });

    expect(result.onHand).toBe(15);
    expect(result.committed).toBe(2);
    expect(result.available).toBe(13); // 15 - 2
  });

  it('happy-path: negative delta decreases on_hand', async () => {
    const { tx, store } = buildMockTx([
      {
        itemId: ITEM,
        locationId: LOC,
        onHand: 10,
        available: 8,
        committed: 2,
        incoming: 0,
        minStock: null,
        reorderPoint: null,
        reorderQty: null,
      },
    ]);
    const txR = makeTxWithRouter(tx, store, ITEM, LOC);

    const result = await applyDeltaAndRecompute(txR, {
      itemId: ITEM,
      locationId: LOC,
      delta: -3,
    });

    expect(result.onHand).toBe(7);
    expect(result.available).toBe(5);
  });

  it('refuses negative on_hand without force', async () => {
    const { tx, store } = buildMockTx([
      {
        itemId: ITEM,
        locationId: LOC,
        onHand: 2,
        available: 2,
        committed: 0,
        incoming: 0,
        minStock: null,
        reorderPoint: null,
        reorderQty: null,
      },
    ]);
    const txR = makeTxWithRouter(tx, store, ITEM, LOC);

    await expect(
      applyDeltaAndRecompute(txR, { itemId: ITEM, locationId: LOC, delta: -5 }),
    ).rejects.toBeInstanceOf(NegativeStockError);
  });

  it('allows negative on_hand when force=true', async () => {
    const { tx, store } = buildMockTx([
      {
        itemId: ITEM,
        locationId: LOC,
        onHand: 2,
        available: 2,
        committed: 0,
        incoming: 0,
        minStock: null,
        reorderPoint: null,
        reorderQty: null,
      },
    ]);
    const txR = makeTxWithRouter(tx, store, ITEM, LOC);

    const result = await applyDeltaAndRecompute(txR, {
      itemId: ITEM,
      locationId: LOC,
      delta: -5,
      force: true,
    });
    expect(result.onHand).toBe(-3);
    expect(result.available).toBe(-3);
  });

  it('inserts new level when (item, location) has none yet', async () => {
    const { tx, store } = buildMockTx([]); // empty store
    const txR = makeTxWithRouter(tx, store, ITEM, LOC);

    const result = await applyDeltaAndRecompute(txR, {
      itemId: ITEM,
      locationId: LOC,
      delta: 7,
    });

    expect(result.onHand).toBe(7);
    expect(result.available).toBe(7);
    expect(result.committed).toBe(0);
    expect(store.size).toBe(1);
  });
});

/**
 * Drizzle's `and(eq(), eq())` produceert SQL-objecten waar onze mock niets mee
 * kan. Deze helper wraps de tx zodat select/update altijd op het meegegeven
 * (itemId, locationId)-paar werkt. Goed genoeg voor unit-tests — integration
 * tests valideren echte SQL-correctheid.
 */
function makeTxWithRouter(
  tx: any,
  store: Map<string, MockLevel>,
  itemId: string,
  locationId: string,
) {
  const key = `${itemId}:${locationId}`;
  return {
    select: () => ({
      from: (_t: unknown) => ({
        where: (_p: unknown) => ({
          limit: async (_n: number) => {
            const r = store.get(key);
            return r ? [r] : [];
          },
        }),
      }),
    }),
    update: (_t: unknown) => ({
      set(values: Partial<MockLevel>) {
        return {
          where(_p: unknown) {
            return {
              async returning() {
                const existing = store.get(key);
                if (!existing) return [];
                const updated = { ...existing, ...values } as MockLevel;
                store.set(key, updated);
                return [updated];
              },
            };
          },
        };
      },
    }),
    insert: (_t: unknown) => ({
      values(v: Partial<MockLevel>) {
        return {
          async returning() {
            const row: MockLevel = {
              itemId: v.itemId!,
              locationId: v.locationId!,
              onHand: v.onHand ?? 0,
              available: v.available ?? 0,
              committed: v.committed ?? 0,
              incoming: v.incoming ?? 0,
              minStock: v.minStock ?? null,
              reorderPoint: v.reorderPoint ?? null,
              reorderQty: v.reorderQty ?? null,
            };
            store.set(`${row.itemId}:${row.locationId}`, row);
            return [row];
          },
        };
      },
    }),
  } as never;
}

// keep tx-builder helper around to avoid unused warnings
void buildMockTx;
