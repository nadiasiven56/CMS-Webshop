import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Marketplace-channel (bol/amazon/gmc). `credentials` wordt encrypted opgeslagen
 * (via CHANNEL_SECRET_KEY door de channel-feature-agent).
 */
export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(), // bol | amazon | gmc
  name: text('name').notNull(),
  status: text('status').notNull().default('disconnected'),
  credentials: jsonb('credentials').$type<Record<string, unknown> | null>(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
