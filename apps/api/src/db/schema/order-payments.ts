import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orders } from './orders.js';

/**
 * Betaling op een order.
 */
export const orderPayments = pgTable('order_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  provider: text('provider'), // mock | ideal | card | bol
  amount: numeric('amount', { precision: 12, scale: 4 }),
  status: text('status').notNull().default('pending'), // pending | paid | failed | refunded
  reference: text('reference'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OrderPayment = typeof orderPayments.$inferSelect;
export type NewOrderPayment = typeof orderPayments.$inferInsert;
