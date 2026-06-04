/**
 * OwnWebshopAdapter — REAL adapter for the first-party storefront channel.
 *
 * Unlike the marketplace adapters this one needs no external credentials: the
 * "channel" is our own CRM. It bridges:
 *   - CRM orders with `channel = 'web'`  → normalized orders (already CRM-side,
 *     so `crmOrderId` is set and the sync just links them into channel_orders).
 *   - published shop_products            → channel_products listings.
 *
 * Connection model: an own_webshop channel points at a CRM shop via
 * `config.shopId` (uuid) or `config.shopSlug`. `verifyConnection` resolves that
 * shop and checks it is active.
 *
 * Idempotency is enforced by the DB UNIQUE constraints
 * (channel_orders_channel_external_unique, channel_products_channel_variant_unique);
 * the sync route does ON CONFLICT-style upserts, so this adapter only produces
 * the normalized data and resolves the linked shop.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../../lib/db.js';
import type { Channel } from '../../../db/schema/channels.js';
import { shops, type Shop } from '../../../db/schema/shops.js';
import { orders } from '../../../db/schema/orders.js';
import { orderItems } from '../../../db/schema/order-items.js';
import { shopProducts } from '../../../db/schema/shop-products.js';
import { variants } from '../../../db/schema/variants.js';
import { isUuid } from '../../../domain/shops/shop-context.js';
import type {
  ChannelAdapter,
  NormalizedListing,
  NormalizedOrder,
  PublishableVariant,
  PushListingResult,
  ShipmentInput,
  VerifyResult,
} from './types.js';

/** Read the shopId/shopSlug binding off a channel's config blob. */
function channelShopBinding(channel: Channel): { shopId?: string; shopSlug?: string } {
  const cfg = (channel.config ?? {}) as Record<string, unknown>;
  const shopId = typeof cfg.shopId === 'string' ? cfg.shopId : undefined;
  const shopSlug = typeof cfg.shopSlug === 'string' ? cfg.shopSlug : undefined;
  return { shopId, shopSlug };
}

/** Resolve the CRM shop this own_webshop channel is bound to. */
async function resolveLinkedShop(channel: Channel): Promise<Shop | null> {
  const { shopId, shopSlug } = channelShopBinding(channel);
  if (shopId && isUuid(shopId)) {
    const [row] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
    if (row) return row;
  }
  if (shopSlug) {
    const [row] = await db.select().from(shops).where(eq(shops.slug, shopSlug)).limit(1);
    if (row) return row;
  }
  // Fallback: if exactly one shop exists, bind to it (single-tenant dev).
  const all = await db.select().from(shops).limit(2);
  if (all.length === 1) return all[0]!;
  return null;
}

export class OwnWebshopAdapter implements ChannelAdapter {
  readonly type = 'own_webshop';

  async verifyConnection(channel: Channel): Promise<VerifyResult> {
    try {
      const shop = await resolveLinkedShop(channel);
      if (!shop) {
        return {
          ok: false,
          detail:
            'No linked shop. Set config.shopId or config.shopSlug to an existing shop.',
        };
      }
      if (shop.status !== 'active') {
        return {
          ok: false,
          detail: `Linked shop '${shop.slug}' is not active (status=${shop.status}).`,
        };
      }
      return { ok: true, detail: `Connected to shop '${shop.slug}' (${shop.name}).` };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'verify failed',
      };
    }
  }

  /**
   * Read CRM orders for the linked shop where channel='web' and normalize them.
   * Because these already live in the CRM, every normalized order carries its
   * `crmOrderId` so the sync links instead of re-creating.
   */
  async fetchOrders(channel: Channel): Promise<NormalizedOrder[]> {
    const shop = await resolveLinkedShop(channel);
    if (!shop) return [];

    const orderRows = await db
      .select()
      .from(orders)
      .where(and(eq(orders.shopId, shop.id), eq(orders.channel, 'web')));

    if (orderRows.length === 0) return [];

    const result: NormalizedOrder[] = [];
    for (const o of orderRows) {
      const items = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, o.id));

      result.push({
        externalId: o.orderNumber,
        channelType: this.type,
        email: o.email,
        currency: o.currency,
        placedAt: o.placedAt ? o.placedAt.toISOString() : o.createdAt.toISOString(),
        crmOrderId: o.id,
        items: items.map((it) => ({
          sku: it.sku,
          title: it.title,
          quantity: it.quantity,
          unitPrice: it.unitPrice ?? '0',
          taxRate: it.taxRate,
          costPrice: it.costPrice,
        })),
        raw: {
          orderId: o.id,
          orderNumber: o.orderNumber,
          shopId: o.shopId,
          status: o.status,
          financialStatus: o.financialStatus,
          fulfillmentStatus: o.fulfillmentStatus,
          grandTotal: o.grandTotal,
        },
      });
    }
    return result;
  }

  /**
   * Resolve the published shop_products → channel-listing shape. Used by the
   * sync route to upsert channel_products + call updateInventory.
   */
  async fetchPublishedListings(channel: Channel): Promise<NormalizedListing[]> {
    const shop = await resolveLinkedShop(channel);
    if (!shop) return [];

    const rows = await db
      .select({
        productId: shopProducts.productId,
        priceOverride: shopProducts.priceOverride,
        variantId: variants.id,
        variantPrice: variants.price,
        sku: variants.sku,
        active: variants.active,
      })
      .from(shopProducts)
      .innerJoin(variants, eq(variants.productId, shopProducts.productId))
      .where(and(eq(shopProducts.shopId, shop.id), eq(shopProducts.published, true)));

    return rows.map((r) => ({
      variantId: r.variantId,
      productId: r.productId,
      sku: r.sku,
      externalId: r.variantId, // own webshop reuses the variant id as external id
      price: r.priceOverride ?? r.variantPrice,
      enabled: r.active,
    }));
  }

  // Own webshop has nothing external to acknowledge / ship to.
  async acknowledgeOrder(_channel: Channel, _externalId: string): Promise<void> {
    /* no-op: order already lives in the CRM */
  }

  async submitShipment(
    _channel: Channel,
    _externalId: string,
    _shipment: ShipmentInput,
  ): Promise<void> {
    /* no-op: fulfillment is handled by the orders module directly */
  }

  /**
   * Publishing a variant on the own webshop is reflected via shop_products /
   * channel_products by the route-layer. The adapter just confirms the external
   * id (= variant id) so the route can persist it onto channel_products.
   */
  async pushListing(
    _channel: Channel,
    variant: PublishableVariant,
  ): Promise<PushListingResult> {
    return { externalId: variant.variantId };
  }

  async updateInventory(
    _channel: Channel,
    _variantId: string,
    _available: number,
  ): Promise<void> {
    /* own webshop reads inventory_levels live; nothing to push outward */
  }

  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    const orderNumber =
      typeof raw.orderNumber === 'string'
        ? raw.orderNumber
        : typeof raw.externalId === 'string'
          ? raw.externalId
          : String(raw.id ?? '');
    return {
      externalId: orderNumber,
      channelType: this.type,
      email: typeof raw.email === 'string' ? raw.email : null,
      currency: typeof raw.currency === 'string' ? raw.currency : 'EUR',
      placedAt: typeof raw.placedAt === 'string' ? raw.placedAt : null,
      crmOrderId: typeof raw.orderId === 'string' ? raw.orderId : null,
      items: [],
      raw,
    };
  }
}

export const ownWebshopAdapter = new OwnWebshopAdapter();
