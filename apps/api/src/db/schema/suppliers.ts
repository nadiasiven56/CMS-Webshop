import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Leverancier (inkoop). `address` is een vrije jsonb-shape.
 */
export type SupplierAddress = {
  line1?: string;
  line2?: string;
  postcode?: string;
  city?: string;
  province?: string;
  country?: string; // ISO-2
};

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: jsonb('address').$type<SupplierAddress | null>(),
  leadTimeDays: integer('lead_time_days').notNull().default(7),
  currency: text('currency').notNull().default('EUR'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
