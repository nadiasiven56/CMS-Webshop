import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  jsonb,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { products } from './products.js';

/**
 * Geld-bedragen zijn `numeric(12,4)` (4 decimalen) — Drizzle geeft dit terug als
 * `string` om float-fouten te voorkomen. Behandel het in code als string en
 * gebruik een Money-helper (zie packages/shared/src/types/money.ts).
 */
export const variants = pgTable('variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull().unique(),
  price: numeric('price', { precision: 12, scale: 4 }).notNull(),
  compareAtPrice: numeric('compare_at_price', { precision: 12, scale: 4 }),
  costPrice: numeric('cost_price', { precision: 12, scale: 4 }),
  weightG: integer('weight_g'),
  lengthMm: integer('length_mm'),
  widthMm: integer('width_mm'),
  heightMm: integer('height_mm'),
  barcode: text('barcode'), // EAN/UPC
  selectedOptions: jsonb('selected_options')
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  position: integer('position').notNull().default(0),
  taxable: boolean('taxable').notNull().default(true),
  taxClass: text('tax_class').notNull().default('standard'), // standard|reduced|zero|exempt
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Variant = typeof variants.$inferSelect;
export type NewVariant = typeof variants.$inferInsert;
