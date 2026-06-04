import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
} from 'drizzle-orm/pg-core';
import { suppliers } from './suppliers.js';
import { locations } from './locations.js';

/**
 * Inkooporder bij een leverancier. supplier = restrict (PO mag leverancier niet
 * laten verdwijnen), location = set null.
 */
export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'restrict' }),
  locationId: uuid('location_id').references(() => locations.id, {
    onDelete: 'set null',
  }),
  reference: text('reference'),
  status: text('status').notNull().default('draft'),
  // draft | ordered | partial | received | cancelled
  currency: text('currency').notNull().default('EUR'),
  subtotal: numeric('subtotal', { precision: 12, scale: 4 }).notNull().default('0'),
  taxTotal: numeric('tax_total', { precision: 12, scale: 4 }).notNull().default('0'),
  total: numeric('total', { precision: 12, scale: 4 }).notNull().default('0'),
  expectedAt: timestamp('expected_at', { withTimezone: true }),
  orderedAt: timestamp('ordered_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
