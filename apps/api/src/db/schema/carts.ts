import {
  pgTable,
  uuid,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.js';
import { customers } from './customers.js';

/**
 * Storefront-winkelwagen. `token` is de publieke handle (unique).
 */
export const carts = pgTable('carts', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  customerId: uuid('customer_id').references(() => customers.id, {
    onDelete: 'set null',
  }),
  currency: text('currency').notNull().default('EUR'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Cart = typeof carts.$inferSelect;
export type NewCart = typeof carts.$inferInsert;
