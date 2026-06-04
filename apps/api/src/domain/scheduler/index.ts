/**
 * Achtergrond-scheduler — periodieke auto-sync van connected channels.
 *
 * Elke interval (default 15 min, override via `SCHEDULER_INTERVAL_MS`):
 *   - selecteer elk channel met status 'connected';
 *   - draai voor elk de GEDEELDE sync-kern `runChannelSync(channelId, {job})`
 *     (exact dezelfde idempotente logica als de `/channels/:id/sync`-route);
 *   - log een samenvatting; een falend channel stopt de loop NOOIT.
 *
 * GARANTIE: dit proces crasht nooit door een sync-fout. Elke run + elke channel
 * zit in een try/catch. Wanneer er niets connected is, is een tick een no-op.
 *
 * GATING (zie startScheduler): draait alleen wanneer `SCHEDULER_ENABLED` truthy
 * is (default: aan, behalve NODE_ENV=test) — zodat test-/migratie-runs geen
 * timers starten.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import { channels } from '../../db/schema/channels.js';
import { reviewSources } from '../../db/schema/reviews.js';
import { runChannelSync } from '../../routes/channels/sync.js';

/** Actief interval-handle; null = scheduler staat uit. */
let timer: NodeJS.Timeout | null = null;
/** Voorkomt overlappende ticks als een run langer duurt dan het interval. */
let running = false;

/**
 * Eén volledige sync-ronde. Throwt NOOIT. Synct alle connected channels en
 * refresht (best-effort) de connected review-sources' lastSyncedAt-stempel.
 */
export async function runSchedulerTick(): Promise<{
  channelsSynced: number;
  channelErrors: number;
}> {
  let channelsSynced = 0;
  let channelErrors = 0;

  try {
    const connected = await db
      .select({ id: channels.id, name: channels.name, type: channels.type })
      .from(channels)
      .where(eq(channels.status, 'connected'));

    if (connected.length === 0) {
      logger.debug('scheduler tick: geen connected channels — no-op');
    }

    for (const ch of connected) {
      try {
        const result = await runChannelSync(ch.id, { type: 'job', id: 'scheduler', ip: null });
        if (result.ok) {
          channelsSynced += 1;
          if (result.errors.length > 0) channelErrors += 1;
        } else {
          // not_connected/unsupported/not_found: geen harde fout, gewoon overslaan.
          channelErrors += 1;
          logger.info(
            { channelId: ch.id, type: ch.type, reason: result.reason },
            'scheduler: channel-sync overgeslagen',
          );
        }
      } catch (err) {
        // runChannelSync hoort niet te gooien, maar als het toch gebeurt: slik + log.
        channelErrors += 1;
        logger.warn({ err, channelId: ch.id }, 'scheduler: channel-sync gooide onverwacht');
      }
    }
  } catch (err) {
    logger.error({ err }, 'scheduler tick: channels-query faalde');
  }

  // Optioneel: connected review-sources' lastFetchAt bumpen (best-effort).
  // Er is (nog) geen poll-API bij de providers; we markeren slechts dat ze
  // meegenomen zijn in de ronde, zodat de admin "laatst opgehaald" ziet.
  try {
    await db
      .update(reviewSources)
      .set({ lastFetchAt: new Date(), updatedAt: new Date() })
      .where(eq(reviewSources.status, 'connected'));
  } catch (err) {
    logger.warn({ err }, 'scheduler: review-sources refresh faalde (genegeerd)');
  }

  logger.info({ channelsSynced, channelErrors }, 'scheduler tick klaar');
  return { channelsSynced, channelErrors };
}

/**
 * Bepaal of de scheduler mag draaien. Expliciete env wint; anders default aan,
 * behalve in NODE_ENV=test (waar timers de test-runner zouden ophouden).
 */
function schedulerEnabled(): boolean {
  if (env.SCHEDULER_ENABLED !== undefined) return env.SCHEDULER_ENABLED;
  return env.NODE_ENV !== 'test';
}

/**
 * Start de periodieke scheduler. Idempotent: een tweede aanroep is een no-op
 * zolang er al een timer loopt. Doet GEEN directe tick (eerste run pas na 1
 * interval) zodat de boot niet vertraagt. De timer is `unref()`'d zodat hij een
 * graceful shutdown niet blokkeert.
 */
export function startScheduler(): void {
  if (timer) return; // al gestart
  if (!schedulerEnabled()) {
    logger.info({ reason: 'disabled' }, 'scheduler niet gestart (SCHEDULER_ENABLED=false of test-env)');
    return;
  }

  const intervalMs = env.SCHEDULER_INTERVAL_MS;
  timer = setInterval(() => {
    if (running) {
      logger.warn('scheduler: vorige tick draait nog — deze overgeslagen');
      return;
    }
    running = true;
    void runSchedulerTick()
      .catch((err) => logger.error({ err }, 'scheduler tick faalde (top-level)'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);

  // Laat de timer het proces niet levend houden bij shutdown.
  if (typeof timer.unref === 'function') timer.unref();

  logger.info({ intervalMs }, 'scheduler gestart (auto channel-sync)');
}

/** Stop de scheduler (graceful shutdown). Idempotent. */
export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('scheduler gestopt');
  }
}
