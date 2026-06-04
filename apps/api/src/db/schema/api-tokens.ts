import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Lange-leef tokens voor storefront/channel-API-toegang.
 * `token_hash` = sha256 van de raw token (raw token wordt 1x getoond bij create).
 * `scope` = 'storefront:shop1', 'channel:bol', 'admin:read', etc.
 */
export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  scope: text('scope').notNull(),
  label: text('label').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
