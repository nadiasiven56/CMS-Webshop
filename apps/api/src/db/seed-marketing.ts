/**
 * Seed-uitbreiding — marketing (feed-configs + storefront-analytics).
 *
 *   Run direct:   `pnpm --filter @webshop-crm/api exec tsx src/db/seed-marketing.ts`
 *   Of via Atlas: `seedMarketing()` aanhaken in de hoofd-seed-flow (seed.ts).
 *
 * Idempotent: voor ELKE bestaande shop maken we (als ze nog niet bestaan):
 *   - een `feed_config` voor 'google_shopping' (disabled = prima, connect-ready)
 *   - een `feed_config` voor 'meta' (disabled)
 *   - één lege `storefront_analytics`-rij (enabled, alle ids null)
 *
 * Tolerant bij 0 shops: dan is er niets te seeden en geeft de functie 0 terug.
 *
 * We leunen op de UNIQUE-constraints:
 *   - feed_config: UNIQUE(shop_id, channel) → onConflictDoNothing
 *   - storefront_analytics: UNIQUE(shop_id) → onConflictDoNothing
 */
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { shops } from './schema/shops.js';
import {
  storefrontAnalytics,
  feedConfig,
  FEED_CHANNELS,
} from './schema/marketing.js';

export interface MarketingSeedResult {
  shops: number;
  feedConfigsInserted: number;
  analyticsInserted: number;
}

export async function seedMarketing(): Promise<MarketingSeedResult> {
  const shopRows = await db.select({ id: shops.id, currency: shops.currency }).from(shops);

  if (shopRows.length === 0) {
    logger.info('no shops found, nothing to seed for marketing');
    return { shops: 0, feedConfigsInserted: 0, analyticsInserted: 0 };
  }

  let feedConfigsInserted = 0;
  let analyticsInserted = 0;

  for (const shop of shopRows) {
    // ── feed_config per channel (default disabled, connect-ready) ──
    for (const channel of FEED_CHANNELS) {
      const inserted = await db
        .insert(feedConfig)
        .values({
          shopId: shop.id,
          channel,
          enabled: false, // operator zet aan zodra de feed-URL in GMC/Meta staat
          includeOutOfStock: false,
          currency: shop.currency ?? 'EUR',
          config: {},
        })
        .onConflictDoNothing({ target: [feedConfig.shopId, feedConfig.channel] })
        .returning({ id: feedConfig.id });
      feedConfigsInserted += inserted.length;
    }

    // ── lege analytics-rij (enabled, ids null) ──
    const analyticsRow = await db
      .insert(storefrontAnalytics)
      .values({ shopId: shop.id })
      .onConflictDoNothing({ target: storefrontAnalytics.shopId })
      .returning({ id: storefrontAnalytics.id });
    analyticsInserted += analyticsRow.length;
  }

  logger.info(
    { shops: shopRows.length, feedConfigsInserted, analyticsInserted },
    'marketing seeded',
  );
  return { shops: shopRows.length, feedConfigsInserted, analyticsInserted };
}

// ─── CLI-entry (alleen als dit bestand direct gerund wordt) ──────────
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /seed-marketing\.[tj]s$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  seedMarketing()
    .then((r) => {
      logger.info(r, 'seed-marketing OK');
    })
    .catch((err) => {
      logger.error({ err }, 'seed-marketing failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
