/**
 * Seed-uitbreiding — review-sources (`review_sources`).
 *
 *   Run direct:   `pnpm --filter @webshop-crm/api exec tsx src/db/seed-reviews.ts`
 *   Of via Atlas: `seedReviews()` aanhaken in de hoofd-seed-flow (seed.ts).
 *
 * Idempotent: `review_sources` heeft GEEN unique-constraint op `provider`, dus we
 * checken per provider op bestaan en slaan over als die er al is — zelfde patroon
 * als seedChannels()/seedNotifications().
 *
 * Wat wordt geseed (review-providers, allemaal 'disconnected'):
 *   - kiyoh      : 'Kiyoh'
 *   - trustpilot : 'Trustpilot'
 *   - google     : 'Google'
 *
 * Credentials blijven leeg; die worden later via channel-crypto encrypted
 * opgeslagen wanneer de operator een source koppelt.
 */
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { reviewSources } from './schema/reviews.js';

export interface ReviewSourceSeedRow {
  provider: string; // kiyoh | trustpilot | google
  name: string;
  status: 'connected' | 'disconnected';
}

/** Bron-dataset — uitbreidbaar met extra review-providers later. */
export const REVIEW_SOURCE_SEED_ROWS: ReviewSourceSeedRow[] = [
  { provider: 'kiyoh', name: 'Kiyoh', status: 'disconnected' },
  { provider: 'trustpilot', name: 'Trustpilot', status: 'disconnected' },
  { provider: 'google', name: 'Google', status: 'disconnected' },
];

/**
 * Idempotente insert van alle review-source-rows. Geeft het aantal feitelijk
 * ingevoegde rijen terug (0 als alles al bestond).
 */
export async function seedReviews(): Promise<{ inserted: number; total: number }> {
  let inserted = 0;
  for (const row of REVIEW_SOURCE_SEED_ROWS) {
    const existing = await db
      .select({ id: reviewSources.id })
      .from(reviewSources)
      .where(eq(reviewSources.provider, row.provider))
      .limit(1);
    if (existing.length > 0) {
      logger.info({ provider: row.provider }, 'review source already exists, skipping');
      continue;
    }
    await db.insert(reviewSources).values({
      provider: row.provider,
      name: row.name,
      status: row.status,
      // credentials/config blijven op schema-default (null / {}).
    });
    inserted += 1;
    logger.info({ provider: row.provider }, 'review source created');
  }
  logger.info({ inserted, total: REVIEW_SOURCE_SEED_ROWS.length }, 'reviews seeded');
  return { inserted, total: REVIEW_SOURCE_SEED_ROWS.length };
}

// ─── CLI-entry (alleen als dit bestand direct gerund wordt) ──────────
//
// Detecteer "direct uitgevoerd" via het script-pad in argv[1]. Bij import (door
// seed.ts of een test) draait dit blok NIET.
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /seed-reviews\.[tj]s$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  seedReviews()
    .then((r) => {
      logger.info(r, 'seed-reviews OK');
    })
    .catch((err) => {
      logger.error({ err }, 'seed-reviews failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
