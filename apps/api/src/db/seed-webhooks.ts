/**
 * Seed-uitbreiding — webhook-dispatcher.
 *
 *   Run direct:   `pnpm --filter @webshop-crm/api exec tsx src/db/seed-webhooks.ts`
 *   Of via Atlas: `seedWebhookDeliveries()` aanhaken in seed.ts.
 *
 * Het delivery-log (`webhook_deliveries`) wordt NOOIT met fake-data geseed — dat
 * is een append-only runtime-log. Deze seed is daarom een veilige no-op voor de
 * deliveries zelf.
 *
 * Optioneel (idempotent): als er nog GEEN enkele webhook bestaat, voegt deze seed
 * één voorbeeld-webhook toe die `active=false` staat (vuurt dus niets), puur zodat
 * de admin-UI/dispatcher-demo een rij heeft om mee te spelen. Bestaan er al
 * webhooks, dan gebeurt er niets.
 */
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { webhooks } from './schema/webhooks.js';

export interface SeedWebhookDeliveriesResult {
  /** Aantal geseede delivery-rijen — altijd 0 (log is runtime-only). */
  inserted: number;
  /** Aantal geseede voorbeeld-webhooks (0 of 1). */
  webhooksInserted: number;
}

/**
 * Idempotente, no-op-veilige seed. Schrijft geen delivery-rijen. Voegt hooguit
 * één disabled voorbeeld-webhook toe als er nog geen enkele bestaat.
 */
export async function seedWebhookDeliveries(): Promise<SeedWebhookDeliveriesResult> {
  let webhooksInserted = 0;

  const existing = await db.select({ id: webhooks.id }).from(webhooks).limit(1);
  if (existing.length === 0) {
    await db.insert(webhooks).values({
      // Globale (shopId null) voorbeeld-webhook, UITGESCHAKELD zodat er niets vuurt.
      event: 'order.created',
      url: 'https://example.com/webhooks/order-created',
      scope: 'order',
      secret: null,
      active: false,
    });
    webhooksInserted = 1;
    logger.info('seed-webhooks: example disabled webhook created (none existed)');
  } else {
    logger.info('seed-webhooks: webhooks already exist, skipping example');
  }

  logger.info({ inserted: 0, webhooksInserted }, 'webhook-deliveries seed (no-op for log)');
  return { inserted: 0, webhooksInserted };
}

// ─── CLI-entry (alleen bij directe uitvoer) ──────────────────
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /seed-webhooks\.[tj]s$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  seedWebhookDeliveries()
    .then((r) => {
      logger.info(r, 'seed-webhooks OK');
    })
    .catch((err) => {
      logger.error({ err }, 'seed-webhooks failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
