import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Uitbetaling vanaf een channel/provider over een periode.
 */
export const payouts = pgTable('payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  channel: text('channel'),
  amount: numeric('amount', { precision: 12, scale: 4 }),
  period: text('period'),
  reference: text('reference'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Payout = typeof payouts.$inferSelect;
export type NewPayout = typeof payouts.$inferInsert;
