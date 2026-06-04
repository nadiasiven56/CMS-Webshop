import {
  pgTable,
  uuid,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import { returns } from './returns.js';
import { orderItems } from './order-items.js';

/**
 * Regel binnen een retour. `restock` = of de voorraad terugkomt.
 */
export const returnItems = pgTable('return_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  returnId: uuid('return_id')
    .notNull()
    .references(() => returns.id, { onDelete: 'cascade' }),
  orderItemId: uuid('order_item_id').references(() => orderItems.id, {
    onDelete: 'set null',
  }),
  quantity: integer('quantity'),
  restock: boolean('restock').notNull().default(true),
});

export type ReturnItem = typeof returnItems.$inferSelect;
export type NewReturnItem = typeof returnItems.$inferInsert;
