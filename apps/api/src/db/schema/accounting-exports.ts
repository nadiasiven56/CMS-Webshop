import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Boekhoud-export (UBL/OSS/ICP/Moneybird) over een periode.
 */
export const accountingExports = pgTable('accounting_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type'), // ubl | oss | icp | moneybird
  period: text('period'),
  status: text('status').notNull().default('pending'),
  filePath: text('file_path'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AccountingExport = typeof accountingExports.$inferSelect;
export type NewAccountingExport = typeof accountingExports.$inferInsert;
