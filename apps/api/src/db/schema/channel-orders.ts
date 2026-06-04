import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { channels } from './channels.js';
import { orders } from './orders.js';

/**
 * Geimporteerde order vanaf een channel. `raw` bewaart de originele payload.
 * UNIQUE(channel_id, external_order_id).
 */
export const channelOrders = pgTable(
  'channel_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    externalOrderId: text('external_order_id'),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    importedAt: timestamp('imported_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    channelExternalUnique: unique('channel_orders_channel_external_unique').on(
      t.channelId,
      t.externalOrderId,
    ),
  }),
);

export type ChannelOrder = typeof channelOrders.$inferSelect;
export type NewChannelOrder = typeof channelOrders.$inferInsert;
