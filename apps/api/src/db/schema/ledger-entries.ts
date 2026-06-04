import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.js';
import { orders } from './orders.js';

/**
 * Grootboek-regel (double-entry-friendly). INDEX(shop_id, entry_date).
 * shop/order = set null zodat historische boekingen blijven bij verwijdering.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'set null' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    entryDate: date('entry_date').notNull(),
    account: text('account').notNull(),
    // revenue | vat_payable | cogs | shipping | payment_fee | refund
    debit: numeric('debit', { precision: 12, scale: 4 }).notNull().default('0'),
    credit: numeric('credit', { precision: 12, scale: 4 }).notNull().default('0'),
    currency: text('currency').notNull().default('EUR'),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }),
    vatCountry: text('vat_country'),
    channel: text('channel'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopDateIdx: index('ledger_entries_shop_date_idx').on(t.shopId, t.entryDate),
  }),
);

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
