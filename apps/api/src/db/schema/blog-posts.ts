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
 * Blog-artikel per shop. UNIQUE(shop_id, slug).
 */
export type BlogPostSeo = {
  title?: string;
  description?: string;
  ogImage?: string;
  noindex?: boolean;
};

export const blogPosts = pgTable(
  'blog_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    excerpt: text('excerpt'),
    bodyHtml: text('body_html'),
    coverImage: text('cover_image'),
    status: text('status').notNull().default('draft'),
    author: text('author'),
    tags: text('tags').array().notNull().default([]),
    seo: jsonb('seo').$type<BlogPostSeo>().notNull().default({}),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopSlugUnique: unique('blog_posts_shop_slug_unique').on(t.shopId, t.slug),
  }),
);

export type BlogPost = typeof blogPosts.$inferSelect;
export type NewBlogPost = typeof blogPosts.$inferInsert;
