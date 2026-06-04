import {
  pgTable,
  uuid,
  integer,
  numeric,
  unique,
} from 'drizzle-orm/pg-core';
import { carts } from './carts.js';
import { variants } from './variants.js';

/**
 * Regel in een winkelwagen. UNIQUE(cart_id, variant_id).
 */
export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 4 }),
  },
  (t) => ({
    cartVariantUnique: unique('cart_items_cart_variant_unique').on(
      t.cartId,
      t.variantId,
    ),
  }),
);

export type CartItem = typeof cartItems.$inferSelect;
export type NewCartItem = typeof cartItems.$inferInsert;
