import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { channels } from './channels.js';
import { products } from './products.js';
import { variants } from './variants.js';

/**
 * Listing van een product/variant op een channel. UNIQUE(channel_id, variant_id).
 */
export const channelProducts = pgTable(
  'channel_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => variants.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    status: text('status').notNull().default('pending'),
    priceOverride: numeric('price_override', { precision: 12, scale: 4 }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  },
  (t) => ({
    channelVariantUnique: unique('channel_products_channel_variant_unique').on(
      t.channelId,
      t.variantId,
    ),
  }),
);

export type ChannelProduct = typeof channelProducts.$inferSelect;
export type NewChannelProduct = typeof channelProducts.$inferInsert;
