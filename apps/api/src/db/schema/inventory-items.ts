import { pgTable, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { variants } from './variants.js';

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    variantId: uuid('variant_id')
      .notNull()
      .unique()
      .references(() => variants.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull().unique(), // duplicaat met variant.sku voor query-ease
    tracked: boolean('tracked').notNull().default(true),
    requiresShipping: boolean('requires_shipping').notNull().default(true),
    gtin: text('gtin'), // 13 of 14 digits (EAN/GTIN)
    gtinIsGs1Registered: boolean('gtin_is_gs1_registered').notNull().default(false),
    hsCode: text('hs_code'),
    countryOfOrigin: text('country_of_origin'), // ISO-2
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    gtinIdx: index('inventory_items_gtin_idx').on(t.gtin),
  }),
);

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;
