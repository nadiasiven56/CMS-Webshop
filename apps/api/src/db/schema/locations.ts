import { pgTable, uuid, text, integer, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // 'main', 'dropship-supplier-x'
  name: text('name').notNull(),
  type: text('type').notNull().default('warehouse'), // warehouse | dropship | virtual
  priority: integer('priority').notNull().default(100),
  address: jsonb('address').$type<LocationAddress | null>(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LocationAddress = {
  line1?: string;
  line2?: string;
  postcode?: string;
  city?: string;
  country?: string; // ISO-2
};

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
