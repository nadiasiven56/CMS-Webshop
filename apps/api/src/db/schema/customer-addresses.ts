import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { customers } from './customers.js';

/**
 * Adres van een klant (billing/shipping). country = ISO-2.
 */
export const customerAddresses = pgTable('customer_addresses', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // billing | shipping
  isDefault: boolean('is_default').notNull().default(false),
  name: text('name'),
  line1: text('line1'),
  line2: text('line2'),
  postcode: text('postcode'),
  city: text('city'),
  province: text('province'),
  country: text('country'), // ISO-2
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CustomerAddress = typeof customerAddresses.$inferSelect;
export type NewCustomerAddress = typeof customerAddresses.$inferInsert;
