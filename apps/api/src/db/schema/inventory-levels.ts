import { pgTable, uuid, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { inventoryItems } from './inventory-items.js';
import { locations } from './locations.js';

export const inventoryLevels = pgTable(
  'inventory_levels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id),
    onHand: integer('on_hand').notNull().default(0),
    available: integer('available').notNull().default(0),
    committed: integer('committed').notNull().default(0),
    incoming: integer('incoming').notNull().default(0),
    minStock: integer('min_stock'),
    reorderPoint: integer('reorder_point'),
    reorderQty: integer('reorder_qty'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    itemLocationUnique: unique('inventory_levels_item_location_unique').on(
      t.itemId,
      t.locationId,
    ),
  }),
);

export type InventoryLevel = typeof inventoryLevels.$inferSelect;
export type NewInventoryLevel = typeof inventoryLevels.$inferInsert;
