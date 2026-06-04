/**
 * Seed-uitbreiding — verzend-carriers (`shipping_carriers`).
 *
 *   Run direct:   `pnpm --filter @webshop-crm/api exec tsx src/db/seed-shipping.ts`
 *   Of via Atlas: `seedShipping()` aanhaken in de hoofd-seed-flow (seed.ts).
 *
 * Idempotent: `shipping_carriers.code` is UNIQUE, dus we checken per code op
 * bestaan en slaan over als die er al is — zelfde patroon als seedChannels.
 *
 * Wat wordt geseed (Fase 5 — verzending):
 *   - sendcloud : 'Sendcloud'  status disconnected (adapter klaar)
 *   - myparcel  : 'MyParcel'   status disconnected (adapter klaar)
 *   - postnl    : 'PostNL'     status disconnected (adapter klaar)
 *   - dhl       : 'DHL'        status disconnected (placeholder, nog geen adapter)
 *
 * Credentials blijven leeg; die worden later via channel-crypto encrypted
 * opgeslagen wanneer de operator een carrier koppelt. Niets vuurt zonder keys.
 */
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { shippingCarriers } from './schema/shipping.js';

export interface CarrierSeedRow {
  code: string; // sendcloud | myparcel | postnl | dhl
  name: string;
  status: 'connected' | 'disconnected';
}

/** Bron-dataset — uitbreidbaar met extra carriers later. */
export const CARRIER_SEED_ROWS: CarrierSeedRow[] = [
  { code: 'sendcloud', name: 'Sendcloud', status: 'disconnected' },
  { code: 'myparcel', name: 'MyParcel', status: 'disconnected' },
  { code: 'postnl', name: 'PostNL', status: 'disconnected' },
  { code: 'dhl', name: 'DHL', status: 'disconnected' },
];

/**
 * Idempotente insert van alle carrier-rows. Geeft het aantal feitelijk
 * ingevoegde rijen terug (0 als alles al bestond).
 */
export async function seedShipping(): Promise<{ inserted: number; total: number }> {
  let inserted = 0;
  for (const row of CARRIER_SEED_ROWS) {
    const existing = await db
      .select({ id: shippingCarriers.id })
      .from(shippingCarriers)
      .where(eq(shippingCarriers.code, row.code))
      .limit(1);
    if (existing.length > 0) {
      logger.info({ code: row.code }, 'shipping carrier already exists, skipping');
      continue;
    }
    await db.insert(shippingCarriers).values({
      code: row.code,
      name: row.name,
      status: row.status,
      // credentials/config blijven op schema-default (null / {}).
    });
    inserted += 1;
    logger.info({ code: row.code }, 'shipping carrier created');
  }
  logger.info({ inserted, total: CARRIER_SEED_ROWS.length }, 'shipping carriers seeded');
  return { inserted, total: CARRIER_SEED_ROWS.length };
}

// ─── CLI-entry (alleen als dit bestand direct gerund wordt) ──────────
//
// Detecteer "direct uitgevoerd" via het script-pad in argv[1]. Bij import (door
// seed.ts of een test) draait dit blok NIET.
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /seed-shipping\.[tj]s$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  seedShipping()
    .then((r) => {
      logger.info(r, 'seed-shipping OK');
    })
    .catch((err) => {
      logger.error({ err }, 'seed-shipping failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
