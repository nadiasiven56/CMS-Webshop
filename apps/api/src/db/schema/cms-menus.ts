import { pgTable, uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { shops } from './shops.js';

/**
 * Navigatie-menu per shop + locatie. UNIQUE(shop_id, location, name).
 */
export const cmsMenus = pgTable(
  'cms_menus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    location: text('location').notNull(), // header | footer | sidebar
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopLocationNameUnique: unique('cms_menus_shop_location_name_unique').on(
      t.shopId,
      t.location,
      t.name,
    ),
  }),
);

export type CmsMenu = typeof cmsMenus.$inferSelect;
export type NewCmsMenu = typeof cmsMenus.$inferInsert;
