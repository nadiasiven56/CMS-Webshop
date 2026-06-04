import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * BTW-tarieven (seed NL + EU). BTW-tarief = numeric(5,2).
 * UNIQUE(country, tax_class, valid_from).
 */
export const vatRates = pgTable(
  'vat_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    country: text('country').notNull(), // ISO-2
    taxClass: text('tax_class').notNull(), // standard | reduced | zero
    rate: numeric('rate', { precision: 5, scale: 2 }).notNull(),
    label: text('label'),
    validFrom: date('valid_from').notNull().default(sql`CURRENT_DATE`),
  },
  (t) => ({
    countryClassFromUnique: unique('vat_rates_country_class_from_unique').on(
      t.country,
      t.taxClass,
      t.validFrom,
    ),
  }),
);

export type VatRate = typeof vatRates.$inferSelect;
export type NewVatRate = typeof vatRates.$inferInsert;
