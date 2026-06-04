import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.js';
import { orders } from './orders.js';

/**
 * RMA / retour-aanvraag.
 */
export const returns = pgTable('returns', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('requested'),
  // requested | approved | received | refunded | rejected
  reason: text('reason'),
  refundAmount: numeric('refund_amount', { precision: 12, scale: 4 })
    .notNull()
    .default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Return = typeof returns.$inferSelect;
export type NewReturn = typeof returns.$inferInsert;
