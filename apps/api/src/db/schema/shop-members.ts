import { pgTable, uuid, text, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { shops } from './shops.js';
import { users } from './users.js';

/**
 * Multi-user: lidmaatschap van een user op een shop. Wie een shop aanmaakt
 * wordt 'owner'. Een `admin`-user (de operator) heeft GEEN membership nodig —
 * die ziet altijd alles (geconsolideerd). Users met role 'user' zien alleen
 * shops waar ze member van zijn.
 */
export const shopMembers = pgTable(
  'shop_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // owner = volledige controle over de shop | staff = meewerken (V1: zelfde rechten)
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopUserUnique: unique('shop_members_shop_user_unique').on(t.shopId, t.userId),
    userIdx: index('shop_members_user_idx').on(t.userId),
  }),
);

export type ShopMember = typeof shopMembers.$inferSelect;
export type NewShopMember = typeof shopMembers.$inferInsert;
