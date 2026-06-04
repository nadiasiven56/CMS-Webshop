import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { cmsMenus } from './cms-menus.js';

/**
 * Menu-item met self-referencing parent (nesting). parent_id → cms_menu_items.id
 * via het AnyPgColumn-pattern voor de self-FK.
 */
export const cmsMenuItems = pgTable('cms_menu_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  menuId: uuid('menu_id')
    .notNull()
    .references(() => cmsMenus.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references((): AnyPgColumn => cmsMenuItems.id, {
    onDelete: 'set null',
  }),
  label: text('label').notNull(),
  url: text('url').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CmsMenuItem = typeof cmsMenuItems.$inferSelect;
export type NewCmsMenuItem = typeof cmsMenuItems.$inferInsert;
