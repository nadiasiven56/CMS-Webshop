/**
 * Channel-sync kern — geëxtraheerd uit de `/channels/:id/sync`-route zodat ZOWEL
 * de route ALS de scheduler exact dezelfde, idempotente sync draaien.
 *
 * `runChannelSync(channelId, actor)`:
 *   - own_webshop: REAL + idempotent — fetchOrders → upsert channel_orders +
 *     updateInventory voor published variants + set lastSyncAt.
 *   - marketplaces: guarded — niet-connected geeft `channel_not_connected`
 *     (de route mapt dat naar 409; de scheduler logt het en gaat door).
 *
 * Het resultaat-object (`ordersImported`/`listingsPushed`/`errors` +
 * `notConnected`) laat de route z'n bestaande 409/200-gedrag exact reproduceren.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { channels } from '../../db/schema/channels.js';
import { channelProducts } from '../../db/schema/channel-products.js';
import { channelOrders } from '../../db/schema/channel-orders.js';
import { inventoryItems } from '../../db/schema/inventory-items.js';
import { inventoryLevels } from '../../db/schema/inventory-levels.js';
import { getAdapter } from './adapters/index.js';
import { OwnWebshopAdapter } from './adapters/own-webshop.js';
import { isChannelNotConnectedError } from './adapters/types.js';

/** Actor voor de sync-audit-rij (user vanuit de route, of 'job' vanuit cron). */
export interface SyncActor {
  type: 'user' | 'job';
  id: string | null;
  ip?: string | null;
}

export type RunChannelSyncResult =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'unsupported_type'; type: string }
  | { ok: false; reason: 'not_connected'; message: string }
  | { ok: true; ordersImported: number; listingsPushed: number; errors: string[] };

/**
 * Idempotente upsert op channel_orders (UNIQUE (channel_id, external_order_id)).
 */
async function upsertChannelOrder(
  channelId: string,
  externalOrderId: string,
  orderId: string | null,
  raw: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(channelOrders)
    .values({ channelId, externalOrderId, orderId, raw })
    .onConflictDoUpdate({
      target: [channelOrders.channelId, channelOrders.externalOrderId],
      set: { orderId, raw },
    });
}

/** Idempotente upsert op channel_products (UNIQUE (channel_id, variant_id)). */
async function upsertChannelProduct(
  channelId: string,
  productId: string,
  variantId: string,
  opts: {
    externalId: string | null;
    status: string;
    markSynced: boolean;
  },
): Promise<void> {
  await db
    .insert(channelProducts)
    .values({
      channelId,
      productId,
      variantId,
      externalId: opts.externalId,
      status: opts.status,
      priceOverride: null,
      lastSyncedAt: opts.markSynced ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [channelProducts.channelId, channelProducts.variantId],
      set: {
        externalId: opts.externalId,
        status: opts.status,
        lastSyncedAt: opts.markSynced ? new Date() : null,
      },
    });
}

/** Verkoopbare voorraad voor een variant = som van inventory_levels.available. */
async function availableForVariant(variantId: string): Promise<number> {
  const rows = await db
    .select({ available: inventoryLevels.available })
    .from(inventoryItems)
    .innerJoin(inventoryLevels, eq(inventoryLevels.itemId, inventoryItems.id))
    .where(eq(inventoryItems.variantId, variantId));
  return rows.reduce((sum, r) => sum + (r.available ?? 0), 0);
}

/**
 * Draai een volledige sync voor één channel. Throwt NIET op een niet-connected
 * marketplace (geeft `{ ok:false, reason:'not_connected' }`); andere fouten
 * worden per-item in `errors` verzameld zoals de route deed.
 */
export async function runChannelSync(
  channelId: string,
  actor: SyncActor,
): Promise<RunChannelSyncResult> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return { ok: false, reason: 'not_found' };

  const adapter = getAdapter(channel);
  if (!adapter) return { ok: false, reason: 'unsupported_type', type: channel.type };

  const errors: string[] = [];
  let ordersImported = 0;
  let listingsPushed = 0;

  // 1) Orders importeren (idempotent upsert op channel_orders).
  try {
    const normalized = await adapter.fetchOrders(channel);
    for (const order of normalized) {
      try {
        await upsertChannelOrder(channel.id, order.externalId, order.crmOrderId ?? null, order.raw);
        ordersImported += 1;
      } catch (err) {
        errors.push(
          `order ${order.externalId}: ${err instanceof Error ? err.message : 'upsert failed'}`,
        );
      }
    }
  } catch (err) {
    if (isChannelNotConnectedError(err)) {
      return {
        ok: false,
        reason: 'not_connected',
        message: err instanceof Error ? err.message : 'not connected',
      };
    }
    errors.push(`fetchOrders: ${err instanceof Error ? err.message : 'failed'}`);
  }

  // 2) Inventory reflecteren voor published variants (alleen own_webshop).
  try {
    if (adapter instanceof OwnWebshopAdapter) {
      const listings = await adapter.fetchPublishedListings(channel);
      for (const listing of listings) {
        try {
          const available = await availableForVariant(listing.variantId);
          await adapter.updateInventory(channel, listing.variantId, available);
          await upsertChannelProduct(channel.id, listing.productId, listing.variantId, {
            externalId: listing.externalId,
            status: listing.enabled ? 'active' : 'disabled',
            markSynced: true,
          });
          listingsPushed += 1;
        } catch (err) {
          errors.push(
            `listing ${listing.variantId}: ${err instanceof Error ? err.message : 'sync failed'}`,
          );
        }
      }
    }
  } catch (err) {
    if (isChannelNotConnectedError(err)) {
      return {
        ok: false,
        reason: 'not_connected',
        message: err instanceof Error ? err.message : 'not connected',
      };
    }
    errors.push(`listings: ${err instanceof Error ? err.message : 'failed'}`);
  }

  // 3) lastSyncAt zetten + audit.
  await runInTransactionWithAudit(async (tx, audit) => {
    await tx
      .update(channels)
      .set({ lastSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(channels.id, channelId));
    audit.set({
      actor: { type: actor.type, id: actor.id },
      action: 'sync',
      entityType: 'channel',
      entityId: channelId,
      after: { ordersImported, listingsPushed, errors: errors.length },
      ip: actor.ip ?? null,
    });
  });

  logger.info(
    { channelId, ordersImported, listingsPushed, errors: errors.length, actor: actor.id, actorType: actor.type },
    'channel synced',
  );

  return { ok: true, ordersImported, listingsPushed, errors };
}
