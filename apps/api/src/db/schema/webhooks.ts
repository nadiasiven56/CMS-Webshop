import { pgTable, text, boolean, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Outbound webhooks — abonnementen op platform-events.
 * `shop_id` null = globale webhook (vuurt voor alle shops).
 * `event` = bv. 'order.created', 'order.shipped', 'channel.synced'.
 * `scope` = grove categorie: 'order' | 'channel' | 'all'.
 * `secret` = optionele HMAC-secret voor signed payloads.
 * `last_fired_at` = laatste keer dat deze webhook is afgevuurd.
 */
export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id'),
  event: text('event').notNull(),
  url: text('url').notNull(),
  secret: text('secret'),
  scope: text('scope').notNull(),
  active: boolean('active').notNull().default(true),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
