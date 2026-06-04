/**
 * Seed-uitbreiding — marketplace-channels (`channels`).
 *
 *   Run direct:   `pnpm --filter @webshop-crm/api exec tsx src/db/seed-channels.ts`
 *   Of via Atlas: `seedChannels()` aanhaken in de hoofd-seed-flow (seed.ts).
 *
 * Idempotent: `channels` heeft GEEN unique-constraint op `type`, dus we kunnen
 * niet op `onConflictDoNothing` leunen (zoals seed-vat dat doet). In plaats
 * daarvan checken we per channel-type op bestaan en slaan we over als die er al
 * is — zelfde patroon als seedAdminUser/seedDefaultLocation in seed.ts.
 *
 * Wat wordt geseed (Fase 3 — marketplaces):
 *   - own_webshop : 'Eigen webshop'  status connected  (de eigen storefront)
 *   - bol         : 'Bol.com'        status disconnected (placeholder)
 *   - amazon      : 'Amazon'         status disconnected (placeholder)
 *
 * Credentials blijven leeg; die worden later via channel-crypto encrypted
 * opgeslagen wanneer de operator een channel koppelt.
 */
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { channels } from './schema/channels.js';

export interface ChannelSeedRow {
  type: string; // own_webshop | bol | amazon | gmc
  name: string;
  status: 'connected' | 'disconnected';
}

/** Bron-dataset — uitbreidbaar met gmc/extra marktplaatsen later. */
export const CHANNEL_SEED_ROWS: ChannelSeedRow[] = [
  { type: 'own_webshop', name: 'Eigen webshop', status: 'connected' },
  { type: 'bol', name: 'Bol.com', status: 'disconnected' },
  { type: 'amazon', name: 'Amazon', status: 'disconnected' },
];

/**
 * Idempotente insert van alle channel-rows. Geeft het aantal feitelijk
 * ingevoegde rijen terug (0 als alles al bestond).
 */
export async function seedChannels(): Promise<{ inserted: number; total: number }> {
  let inserted = 0;
  for (const row of CHANNEL_SEED_ROWS) {
    const existing = await db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.type, row.type))
      .limit(1);
    if (existing.length > 0) {
      logger.info({ type: row.type }, 'channel already exists, skipping');
      continue;
    }
    await db.insert(channels).values({
      type: row.type,
      name: row.name,
      status: row.status,
      // credentials/config blijven op schema-default (null / {}).
    });
    inserted += 1;
    logger.info({ type: row.type }, 'channel created');
  }
  logger.info({ inserted, total: CHANNEL_SEED_ROWS.length }, 'channels seeded');
  return { inserted, total: CHANNEL_SEED_ROWS.length };
}

// ─── CLI-entry (alleen als dit bestand direct gerund wordt) ──────────
//
// Detecteer "direct uitgevoerd" via het script-pad in argv[1]. Bij import (door
// seed.ts of een test) draait dit blok NIET.
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /seed-channels\.[tj]s$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  seedChannels()
    .then((r) => {
      logger.info(r, 'seed-channels OK');
    })
    .catch((err) => {
      logger.error({ err }, 'seed-channels failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
