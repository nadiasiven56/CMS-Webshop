import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  descriptionHtml: text('description_html'),
  vendor: text('vendor'),
  productType: text('product_type'),
  // status: draft | active | archived
  status: text('status').notNull().default('draft'),
  // tags als comma-separated tekst — Drizzle pg `text[]` vereist .array()
  // helper, en simpele text-CSV voldoet voor V1 admin-search.
  // Ingevuld door product-feature-agent.
  tags: text('tags').array().notNull().default([]),
  // Multi-user: eigenaar van het product. NULL = platform/operator-catalogus
  // (alle pre-multi-user producten). Users met role 'user' zien/beheren alleen
  // hun eigen producten; admin ziet alles.
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
