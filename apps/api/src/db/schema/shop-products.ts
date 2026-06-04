import {
  pgTable,
  uuid,
  boolean,
  numeric,
  integer,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.js';
import { products } from './products.js';

/**
 * Join-tabel: gedeelde catalogus, per shop publiceren met optionele
 * prijs-override. UNIQUE(shop_id, product_id).
 */
export const shopProducts = pgTable(
  'shop_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    published: boolean('published').notNull().default(false),
    priceOverride: numeric('price_override', { precision: 12, scale: 4 }), // null = variant-prijs
    position: integer('position').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => ({
    shopProductUnique: unique('shop_products_shop_product_unique').on(
      t.shopId,
      t.productId,
    ),
  }),
);

export type ShopProduct = typeof shopProducts.$inferSelect;
export type NewShopProduct = typeof shopProducts.$inferInsert;
