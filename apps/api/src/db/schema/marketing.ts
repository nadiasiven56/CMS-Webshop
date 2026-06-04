import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.js';

/**
 * Marketing & storefront-analytics — Wave-M (marketing feeds + storefront tags).
 *
 * Twee tabellen, beide per-shop:
 *
 *  - `storefront_analytics` — per shop EXACT 1 rij (UNIQUE shop_id) met de
 *    publieke tag-ids (GA4 measurement id, Meta Pixel id, Google Ads conversion
 *    id + label) die de storefront moet renderen. Geen geheimen: dit zijn
 *    client-side ids die toch al in de browser-HTML staan. `customHeadHtml` is
 *    een vrije escape-hatch voor extra <head>-snippets (verification-meta, etc.).
 *
 *  - `feed_config` — per (shop, channel) 1 rij. Stuurt hoe de publieke
 *    product-feed (Google Shopping XML / Meta CSV) wordt opgebouwd. Bevat GEEN
 *    extern account — de feed is "connect-ready": de operator plakt de publieke
 *    feed-URL in Google Merchant Center / Meta Commerce Manager, dat account
 *    crawlt de URL. `config` is een vrij jsonb-blob voor channel-specifieke
 *    tuning (bv. brand-fallback, productType-mapping).
 *
 * Conventies: timestamps `withTimezone`; updated_at wordt in code gezet
 * (`updatedAt: new Date()`), net als de andere modules (geen DB-trigger nodig).
 */

/** Feed-channels waarvoor een generator bestaat. */
export const FEED_CHANNELS = ['google_shopping', 'meta'] as const;
export type FeedChannel = (typeof FEED_CHANNELS)[number];

// ─── storefront_analytics ─────────────────────────────────────

export const storefrontAnalytics = pgTable(
  'storefront_analytics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .unique()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // GA4 measurement id, bv. 'G-XXXXXXXXXX'. Nullable: pas later ingevuld.
    ga4MeasurementId: text('ga4_measurement_id'),
    // Meta/Facebook Pixel id (numeriek-string), bv. '123456789012345'.
    metaPixelId: text('meta_pixel_id'),
    // Google Ads conversion id, bv. 'AW-123456789'.
    googleAdsId: text('google_ads_id'),
    // Google Ads conversion label (hoort bij een specifieke conversie-actie).
    googleAdsConversionLabel: text('google_ads_conversion_label'),
    // Vrije <head>-HTML (verification-meta's, extra tags). Storefront rendert
    // dit rauw — operator-verantwoordelijkheid.
    customHeadHtml: text('custom_head_html'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type StorefrontAnalytics = typeof storefrontAnalytics.$inferSelect;
export type NewStorefrontAnalytics = typeof storefrontAnalytics.$inferInsert;

// ─── feed_config ──────────────────────────────────────────────

export const feedConfig = pgTable(
  'feed_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // 'google_shopping' | 'meta' — zie FEED_CHANNELS.
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    // Of out-of-stock producten in de feed mogen (default: alleen in-stock).
    includeOutOfStock: boolean('include_out_of_stock').notNull().default(false),
    currency: text('currency').notNull().default('EUR'),
    // Vrij channel-specifiek tuning-blob (brand-fallback, productType-map, ...).
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    // Wanneer de feed voor het laatst (her)gebouwd is — gezet door /rebuild.
    lastBuiltAt: timestamp('last_built_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    feedConfigShopChannelUnique: unique('feed_config_shop_channel_unique').on(
      t.shopId,
      t.channel,
    ),
  }),
);

export type FeedConfig = typeof feedConfig.$inferSelect;
export type NewFeedConfig = typeof feedConfig.$inferInsert;
