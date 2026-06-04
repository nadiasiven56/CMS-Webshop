import { pgTable, uuid, text, integer } from 'drizzle-orm/pg-core';
import { productOptions } from './product-options.js';

export const productOptionValues = pgTable('product_option_values', {
  id: uuid('id').primaryKey().defaultRandom(),
  optionId: uuid('option_id')
    .notNull()
    .references(() => productOptions.id, { onDelete: 'cascade' }),
  value: text('value').notNull(), // 'Red', 'M'
  position: integer('position').notNull().default(0),
});

export type ProductOptionValue = typeof productOptionValues.$inferSelect;
export type NewProductOptionValue = typeof productOptionValues.$inferInsert;
