import { pgTable, uuid, text, integer, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { inventoryItems } from './inventory-items.js';
import { locations } from './locations.js';

export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id),
    quantity: integer('quantity').notNull(),
    reason: text('reason').notNull(), // 'cart' | 'order' | 'manual'
    refType: text('ref_type').notNull(), // 'cart' | 'order'
    refId: uuid('ref_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    quantityPositive: check('inventory_reservations_qty_positive', sql`${t.quantity} > 0`),
    expiresIdx: index('inventory_reservations_expires_idx').on(t.expiresAt),
  }),
);

export type InventoryReservation = typeof inventoryReservations.$inferSelect;
export type NewInventoryReservation = typeof inventoryReservations.$inferInsert;
