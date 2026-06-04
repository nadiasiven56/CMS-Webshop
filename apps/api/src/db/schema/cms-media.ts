import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { shops } from './shops.js';

/**
 * Media-library. shop_id NULL = globaal (gedeeld over alle shops).
 */
export const cmsMedia = pgTable('cms_media', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }), // nullable = globaal
  url: text('url').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime'),
  sizeBytes: integer('size_bytes'),
  width: integer('width'),
  height: integer('height'),
  alt: text('alt'),
  folder: text('folder').notNull().default('uploads'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CmsMedia = typeof cmsMedia.$inferSelect;
export type NewCmsMedia = typeof cmsMedia.$inferInsert;
