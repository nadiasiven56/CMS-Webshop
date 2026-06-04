import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.js';

/**
 * URL-redirects per shop. UNIQUE(shop_id, from_path).
 */
export const cmsRedirects = pgTable(
  'cms_redirects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    fromPath: text('from_path').notNull(),
    toPath: text('to_path').notNull(),
    statusCode: integer('status_code').notNull().default(301),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopFromPathUnique: unique('cms_redirects_shop_from_path_unique').on(
      t.shopId,
      t.fromPath,
    ),
  }),
);

export type CmsRedirect = typeof cmsRedirects.$inferSelect;
export type NewCmsRedirect = typeof cmsRedirects.$inferInsert;
