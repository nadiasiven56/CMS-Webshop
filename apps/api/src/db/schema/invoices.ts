import {
  pgTable,
  uuid,
  text,
  numeric,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.js';
import { orders } from './orders.js';

/**
 * Factuur (sales/credit). UBL-XML opgeslagen voor e-facturatie.
 * UNIQUE(shop_id, invoice_number). shop = restrict.
 */
export type InvoiceCustomer = {
  name?: string;
  company?: string;
  vatNumber?: string;
  email?: string;
  address?: {
    line1?: string;
    line2?: string;
    postcode?: string;
    city?: string;
    province?: string;
    country?: string;
  };
};

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    invoiceNumber: text('invoice_number').notNull(),
    type: text('type').notNull().default('sales'), // sales | credit
    customer: jsonb('customer').$type<InvoiceCustomer>(),
    lines: jsonb('lines').$type<unknown[]>().notNull().default([]),
    subtotal: numeric('subtotal', { precision: 12, scale: 4 }),
    vatTotal: numeric('vat_total', { precision: 12, scale: 4 }),
    total: numeric('total', { precision: 12, scale: 4 }),
    status: text('status').notNull().default('issued'),
    ublXml: text('ubl_xml'),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopInvoiceNumberUnique: unique('invoices_shop_invoice_number_unique').on(
      t.shopId,
      t.invoiceNumber,
    ),
  }),
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
