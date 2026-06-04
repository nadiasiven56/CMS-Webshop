import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
} from 'drizzle-orm/pg-core';
import { orders } from './orders.js';
import { variants } from './variants.js';

/**
 * Order-regel. variant_id = set null (variant kan verdwijnen, regel blijft
 * historisch). sku/title gesnapshot voor leesbaarheid.
 */
export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').references(() => variants.id, {
    onDelete: 'set null',
  }),
  sku: text('sku'),
  title: text('title'),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 4 }),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('21'),
  taxAmount: numeric('tax_amount', { precision: 12, scale: 4 }).notNull().default('0'),
  costPrice: numeric('cost_price', { precision: 12, scale: 4 }), // voor marge
  lineTotal: numeric('line_total', { precision: 12, scale: 4 }),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
