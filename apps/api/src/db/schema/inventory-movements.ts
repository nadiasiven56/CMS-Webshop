import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { inventoryItems } from './inventory-items.js';
import { locations } from './locations.js';

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id),
    delta: integer('delta').notNull(), // +5 receive, -3 ship, +1 adjust
    reason: text('reason').notNull(), // 'sale', 'return', 'po_receive', 'adjust', 'transfer'
    refType: text('ref_type'), // 'order', 'po', 'manual'
    refId: uuid('ref_id'),
    actorId: uuid('actor_id'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    itemIdx: index('inventory_movements_item_idx').on(t.itemId, t.createdAt),
  }),
);

export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type NewInventoryMovement = typeof inventoryMovements.$inferInsert;
