/**
 * Recompute helper: `available = on_hand - committed`.
 *
 * Bron-of-truth-regel:
 *   - `on_hand`   = fysiek aanwezig (mag NIET negatief zijn)
 *   - `committed` = wat gereserveerd is voor active orders/carts
 *   - `available` = wat verkoopbaar is (= on_hand - committed)
 *
 * Deze helper is bedoeld om op een (item, location)-paar de `available` opnieuw
 * uit te rekenen na een wijziging op `on_hand` of `committed`. Hij is bewust
 * een pure functie + 1 update — zo kan zowel stock-agent (adjust) als later
 * orders-agent (reserveren/release) hem hergebruiken zonder dubbele logica.
 *
 * Gebruik ALTIJD binnen een Drizzle-transaction. De caller is verantwoordelijk
 * voor transaction-scoping (we accepteren een tx-handle als parameter).
 */
import { eq, and } from 'drizzle-orm';
import { inventoryLevels } from '../../db/schema/inventory-levels.js';
import type { db as DB } from '../../lib/db.js';

/**
 * Een tx-handle: ofwel `db` ofwel `tx` binnen `db.transaction(...)`. Drizzle's
 * `tx` heeft dezelfde shape als `db` voor de operaties die we hier gebruiken.
 */
export type DbOrTx = typeof DB;

export interface InventoryLevelSnapshot {
  itemId: string;
  locationId: string;
  onHand: number;
  available: number;
  committed: number;
  incoming: number;
  minStock: number | null;
  reorderPoint: number | null;
  reorderQty: number | null;
}

/**
 * Lees de huidige inventory-level voor (item, location). Geeft `null` als er
 * nog geen row is (V1: niet alle items hebben in alle locations een level-row;
 * stock-adjust moet die zelf upserten).
 */
export async function getLevel(
  tx: DbOrTx,
  itemId: string,
  locationId: string,
): Promise<InventoryLevelSnapshot | null> {
  const [row] = await tx
    .select()
    .from(inventoryLevels)
    .where(
      and(
        eq(inventoryLevels.itemId, itemId),
        eq(inventoryLevels.locationId, locationId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    itemId: row.itemId,
    locationId: row.locationId,
    onHand: row.onHand,
    available: row.available,
    committed: row.committed,
    incoming: row.incoming,
    minStock: row.minStock,
    reorderPoint: row.reorderPoint,
    reorderQty: row.reorderQty,
  };
}

/**
 * Pas een delta toe op `on_hand` voor (item, location) en herbereken
 * `available = on_hand - committed`.
 *
 * - Maakt geen movement-row (dat doet de caller, omdat `reason`/`actor` per
 *   call verschilt).
 * - Geeft de NIEUWE snapshot terug.
 * - Werpt een `NegativeStockError` als resulterende `on_hand` < 0 en `force`
 *   niet aan staat.
 */
export class NegativeStockError extends Error {
  readonly code = 'negative_stock' as const;
  constructor(
    public readonly itemId: string,
    public readonly locationId: string,
    public readonly currentOnHand: number,
    public readonly delta: number,
  ) {
    super(
      `Adjustment would result in negative on_hand (current=${currentOnHand}, delta=${delta}). ` +
        `Use ?force=true to override.`,
    );
  }
}

export interface ApplyDeltaInput {
  itemId: string;
  locationId: string;
  delta: number;
  /** Wanneer true: sta toe dat on_hand negatief wordt (operator-override). */
  force?: boolean;
}

export async function applyDeltaAndRecompute(
  tx: DbOrTx,
  input: ApplyDeltaInput,
): Promise<InventoryLevelSnapshot> {
  const { itemId, locationId, delta, force = false } = input;

  // Lees of-create-with-zeroes
  const existing = await getLevel(tx, itemId, locationId);

  const currentOnHand = existing?.onHand ?? 0;
  const currentCommitted = existing?.committed ?? 0;
  const newOnHand = currentOnHand + delta;

  if (newOnHand < 0 && !force) {
    throw new NegativeStockError(itemId, locationId, currentOnHand, delta);
  }

  const newAvailable = newOnHand - currentCommitted;

  if (existing) {
    const [updated] = await tx
      .update(inventoryLevels)
      .set({
        onHand: newOnHand,
        available: newAvailable,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryLevels.itemId, itemId),
          eq(inventoryLevels.locationId, locationId),
        ),
      )
      .returning();
    if (!updated) {
      throw new Error('Failed to update inventory_levels (no row returned)');
    }
    return {
      itemId: updated.itemId,
      locationId: updated.locationId,
      onHand: updated.onHand,
      available: updated.available,
      committed: updated.committed,
      incoming: updated.incoming,
      minStock: updated.minStock,
      reorderPoint: updated.reorderPoint,
      reorderQty: updated.reorderQty,
    };
  }

  // Geen bestaande row: insert.
  const [inserted] = await tx
    .insert(inventoryLevels)
    .values({
      itemId,
      locationId,
      onHand: newOnHand,
      available: newAvailable,
      committed: 0,
      incoming: 0,
    })
    .returning();
  if (!inserted) {
    throw new Error('Failed to insert inventory_levels (no row returned)');
  }
  return {
    itemId: inserted.itemId,
    locationId: inserted.locationId,
    onHand: inserted.onHand,
    available: inserted.available,
    committed: inserted.committed,
    incoming: inserted.incoming,
    minStock: inserted.minStock,
    reorderPoint: inserted.reorderPoint,
    reorderQty: inserted.reorderQty,
  };
}

/**
 * Herbereken `available` zonder `on_hand` te muteren — bedoeld voor wanneer
 * orders-agent `committed` aanpast. V1 nog niet aangeroepen, maar al klaar
 * zodat orders-agent (Fase 2/3) niet dubbel logica hoeft te schrijven.
 */
export async function recomputeAvailable(
  tx: DbOrTx,
  itemId: string,
  locationId: string,
): Promise<InventoryLevelSnapshot | null> {
  const existing = await getLevel(tx, itemId, locationId);
  if (!existing) return null;
  const newAvailable = existing.onHand - existing.committed;
  if (newAvailable === existing.available) return existing;
  const [updated] = await tx
    .update(inventoryLevels)
    .set({ available: newAvailable, updatedAt: new Date() })
    .where(
      and(
        eq(inventoryLevels.itemId, itemId),
        eq(inventoryLevels.locationId, locationId),
      ),
    )
    .returning();
  if (!updated) return null;
  return {
    itemId: updated.itemId,
    locationId: updated.locationId,
    onHand: updated.onHand,
    available: updated.available,
    committed: updated.committed,
    incoming: updated.incoming,
    minStock: updated.minStock,
    reorderPoint: updated.reorderPoint,
    reorderQty: updated.reorderQty,
  };
}
