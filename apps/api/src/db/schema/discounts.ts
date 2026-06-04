import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.js';

/**
 * Discount-/voucher-codes. Een code kan globaal zijn (shopId = null) of aan één
 * shop gebonden (shopId gezet). Codes worden ALTIJD UPPERCASE opgeslagen; de
 * validatie matcht case-insensitive maar de schrijflaag normaliseert.
 *
 * UNIQUE(shop_id, code) — per shop is een code uniek. Postgres behandelt NULLs
 * als distinct, dus meerdere globale codes met dezelfde tekst zouden technisch
 * naast elkaar kunnen bestaan; de route-laag pre-checkt dat (409 duplicate_code)
 * zodat een globale code ook echt uniek is.
 *
 * Geld (`value`, `minSubtotal`) = numeric(12,4)-string (Money-conventie). Voor
 * percentage-codes is `value` het percentage (bv '10.0000' = 10%); voor fixed
 * het bedrag in valuta; voor free_shipping wordt `value` genegeerd.
 */
export const discounts = pgTable(
  'discounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(), // UPPERCASE opgeslagen
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // percentage | fixed | free_shipping
    value: numeric('value', { precision: 12, scale: 4 }).notNull().default('0'),
    currency: text('currency').notNull().default('EUR'),
    minSubtotal: numeric('min_subtotal', { precision: 12, scale: 4 }),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    maxRedemptions: integer('max_redemptions'),
    maxPerCustomer: integer('max_per_customer'),
    timesRedeemed: integer('times_redeemed').notNull().default(0),
    active: boolean('active').notNull().default(true),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopCodeUnique: unique('discounts_shop_code_unique').on(t.shopId, t.code),
    codeIdx: index('discounts_code_idx').on(t.code),
  }),
);

export type Discount = typeof discounts.$inferSelect;
export type NewDiscount = typeof discounts.$inferInsert;

/**
 * Redemption-log (append-only). Eén rij per toepassing van een code op een
 * order. Idempotentie van `recordDiscountRedemption` leunt op (discountId,
 * orderId): bestaat er al een rij voor dat paar, dan slaan we de insert + de
 * counter-bump over. `amountApplied` = de werkelijk toegepaste korting in
 * valuta (numeric(12,4)-string).
 */
export const discountRedemptions = pgTable(
  'discount_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discountId: uuid('discount_id')
      .notNull()
      .references(() => discounts.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id'),
    customerEmail: text('customer_email'),
    amountApplied: numeric('amount_applied', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    discountIdx: index('discount_redemptions_discount_idx').on(t.discountId),
    orderIdx: index('discount_redemptions_order_idx').on(t.orderId),
  }),
);

export type DiscountRedemption = typeof discountRedemptions.$inferSelect;
export type NewDiscountRedemption = typeof discountRedemptions.$inferInsert;
