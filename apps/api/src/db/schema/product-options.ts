import { pgTable, uuid, text, integer } from 'drizzle-orm/pg-core';
import { products } from './products.js';

export const productOptions = pgTable('product_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // 'Color', 'Size'
  position: integer('position').notNull().default(0),
});

export type ProductOption = typeof productOptions.$inferSelect;
export type NewProductOption = typeof productOptions.$inferInsert;
