import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Sessies worden geidentificeerd door een sha256-hash van de cookie-token.
 * `id` is dus de hash, NIET de token zelf — bewuste safety-keuze
 * (zie lib/auth.ts).
 */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256(hex) van session-token
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
