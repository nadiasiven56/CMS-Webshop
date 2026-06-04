import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.js';

/**
 * Klant per shop. UNIQUE(shop_id, email). `orders_count` / `total_spent` zijn
 * denormalized aggregaten (door order-feature-agent bijgewerkt).
 */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    phone: text('phone'),
    company: text('company'),
    vatNumber: text('vat_number'), // B2B
    acceptsMarketing: boolean('accepts_marketing').notNull().default(false),
    tags: text('tags').array().notNull().default([]),
    notes: text('notes'),
    ordersCount: integer('orders_count').notNull().default(0),
    totalSpent: numeric('total_spent', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopEmailUnique: unique('customers_shop_email_unique').on(t.shopId, t.email),
  }),
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
