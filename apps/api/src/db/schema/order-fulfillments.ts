import {
  pgTable,
  uuid,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orders } from './orders.js';
import { locations } from './locations.js';

/**
 * Fulfillment (verzending) van een order vanaf een locatie.
 */
export const orderFulfillments = pgTable('order_fulfillments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').references(() => locations.id, {
    onDelete: 'set null',
  }),
  status: text('status').notNull().default('pending'),
  carrier: text('carrier'),
  trackingCode: text('tracking_code'),
  trackingUrl: text('tracking_url'),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OrderFulfillment = typeof orderFulfillments.$inferSelect;
export type NewOrderFulfillment = typeof orderFulfillments.$inferInsert;
