import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { products } from './products.js';

export const productImages = pgTable('product_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  // Voor V1 = pad naar local-storage (`/storage/images/...`); image-feature-agent
  // mag dit later aanvullen met variants of CDN-url's.
  url: text('url').notNull(),
  alt: text('alt'),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProductImage = typeof productImages.$inferSelect;
export type NewProductImage = typeof productImages.$inferInsert;
