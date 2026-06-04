import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
} from 'drizzle-orm/pg-core';
import { purchaseOrders } from './purchase-orders.js';
import { variants } from './variants.js';

/**
 * Regel binnen een inkooporder. variant = set null (historisch behoud).
 */
export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  poId: uuid('po_id')
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').references(() => variants.id, {
    onDelete: 'set null',
  }),
  sku: text('sku'),
  quantity: integer('quantity').notNull(),
  unitCost: numeric('unit_cost', { precision: 12, scale: 4 }),
  quantityReceived: integer('quantity_received').notNull().default(0),
});

export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type NewPurchaseOrderItem = typeof purchaseOrderItems.$inferInsert;
