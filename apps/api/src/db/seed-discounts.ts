/**
 * Seed-uitbreiding — voorbeeld-kortingscodes (`discounts`).
 *
 *   Run direct:   `pnpm --filter @webshop-crm/api exec tsx src/db/seed-discounts.ts`
 *   Of via Atlas: `seedDiscounts()` aanhaken in de hoofd-seed-flow (seed.ts).
 *
 * Idempotent: we checken per (code, shopId) op bestaan en slaan over als die er
 * al is — zelfde patroon als seed-channels (geen onConflict want de UNIQUE op
 * (shop_id, code) telt NULL-shopId als distinct).
 *
 * Wat wordt geseed (globale codes, shopId = null):
 *   - WELKOM10          : 10% korting, actief
 *   - GRATISVERZENDING  : gratis verzending, actief
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { discounts } from './schema/discounts.js';

export interface DiscountSeedRow {
  code: string;
  shopId: string | null;
  type: 'percentage' | 'fixed' | 'free_shipping';
  value: string; // numeric(12,4)-string; genegeerd voor free_shipping
  currency?: string;
  minSubtotal?: string | null;
  active: boolean;
  description?: string | null;
}

/** Bron-dataset — globale voorbeeldcodes. */
export const DISCOUNT_SEED_ROWS: DiscountSeedRow[] = [
  {
    code: 'WELKOM10',
    shopId: null,
    type: 'percentage',
    value: '10.0000',
    active: true,
    description: '10% welkomstkorting op je bestelling',
  },
  {
    code: 'GRATISVERZENDING',
    shopId: null,
    type: 'free_shipping',
    value: '0',
    active: true,
    description: 'Gratis verzending op je bestelling',
  },
];

/**
 * Idempotente insert van alle voorbeeld-codes. Geeft het aantal feitelijk
 * ingevoegde rijen terug (0 als alles al bestond).
 */
export async function seedDiscounts(): Promise<{ inserted: number; total: number }> {
  let inserted = 0;
  for (const row of DISCOUNT_SEED_ROWS) {
    const code = row.code.toUpperCase();
    const existing = await db
      .select({ id: discounts.id })
      .from(discounts)
      .where(
        and(
          eq(discounts.code, code),
          row.shopId ? eq(discounts.shopId, row.shopId) : isNull(discounts.shopId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      logger.info({ code }, 'discount already exists, skipping');
      continue;
    }
    await db.insert(discounts).values({
      code,
      shopId: row.shopId,
      type: row.type,
      value: row.type === 'free_shipping' ? '0' : row.value,
      ...(row.currency ? { currency: row.currency } : {}),
      minSubtotal: row.minSubtotal ?? null,
      active: row.active,
      description: row.description ?? null,
    });
    inserted += 1;
    logger.info({ code }, 'discount created');
  }
  logger.info({ inserted, total: DISCOUNT_SEED_ROWS.length }, 'discounts seeded');
  return { inserted, total: DISCOUNT_SEED_ROWS.length };
}

// ─── CLI-entry (alleen als dit bestand direct gerund wordt) ──────────
//
// Detecteer "direct uitgevoerd" via het script-pad in argv[1]. Bij import (door
// seed.ts of een test) draait dit blok NIET.
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /seed-discounts\.[tj]s$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  seedDiscounts()
    .then((r) => {
      logger.info(r, 'seed-discounts OK');
    })
    .catch((err) => {
      logger.error({ err }, 'seed-discounts failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
