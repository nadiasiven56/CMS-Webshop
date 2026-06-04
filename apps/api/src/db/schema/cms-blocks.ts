import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.js';

/**
 * Herbruikbare/globale secties (header, footer, banners). UNIQUE(shop_id, key).
 */
export const cmsBlocks = pgTable(
  'cms_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    type: text('type').notNull(), // hero | richtext | banner | product-grid | html
    content: jsonb('content').$type<Record<string, unknown>>().notNull().default({}),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopKeyUnique: unique('cms_blocks_shop_key_unique').on(t.shopId, t.key),
  }),
);

export type CmsBlock = typeof cmsBlocks.$inferSelect;
export type NewCmsBlock = typeof cmsBlocks.$inferInsert;
