import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.js';

/**
 * CMS-pagina (page-builder). `blocks` is een geordende array van block-objecten.
 * UNIQUE(shop_id, slug).
 */
export type CmsPageSeo = {
  title?: string;
  description?: string;
  ogImage?: string;
  noindex?: boolean;
};

export const cmsPages = pgTable(
  'cms_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('draft'), // draft | published
    template: text('template').notNull().default('default'),
    blocks: jsonb('blocks').$type<unknown[]>().notNull().default([]),
    seo: jsonb('seo').$type<CmsPageSeo>().notNull().default({}),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopSlugUnique: unique('cms_pages_shop_slug_unique').on(t.shopId, t.slug),
  }),
);

export type CmsPage = typeof cmsPages.$inferSelect;
export type NewCmsPage = typeof cmsPages.$inferInsert;
