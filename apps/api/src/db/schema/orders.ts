import {
  pgTable,
  uuid,
  text,
  numeric,
  jsonb,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.js';
import { customers } from './customers.js';

/**
 * Order. Per-shop oplopend `order_number` (bv 'CR-1001').
 * UNIQUE(shop_id, order_number) · INDEX(shop_id, status, created_at).
 * FK shop = restrict (orders mogen een shop niet laten verdwijnen).
 */
export type OrderAddress = {
  name?: string;
  company?: string;
  line1?: string;
  line2?: string;
  postcode?: string;
  city?: string;
  province?: string;
  country?: string; // ISO-2
  phone?: string;
};

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    orderNumber: text('order_number').notNull(), // per-shop, bv 'CR-1001'
    customerId: uuid('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    email: text('email'),
    channel: text('channel').notNull().default('web'), // web | bol | amazon | gmc
    status: text('status').notNull().default('pending'),
    // pending | paid | fulfilled | shipped | delivered | cancelled | refunded
    financialStatus: text('financial_status').notNull().default('pending'),
    // pending | paid | partially_refunded | refunded
    fulfillmentStatus: text('fulfillment_status').notNull().default('unfulfilled'),
    currency: text('currency').notNull().default('EUR'),
    subtotal: numeric('subtotal', { precision: 12, scale: 4 }),
    discountTotal: numeric('discount_total', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    shippingTotal: numeric('shipping_total', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    taxTotal: numeric('tax_total', { precision: 12, scale: 4 }).notNull().default('0'),
    grandTotal: numeric('grand_total', { precision: 12, scale: 4 }),
    billingAddress: jsonb('billing_address').$type<OrderAddress>(),
    shippingAddress: jsonb('shipping_address').$type<OrderAddress>(),
    note: text('note'),
    placedAt: timestamp('placed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shopOrderNumberUnique: unique('orders_shop_order_number_unique').on(
      t.shopId,
      t.orderNumber,
    ),
    shopStatusCreatedIdx: index('orders_shop_status_created_idx').on(
      t.shopId,
      t.status,
      t.createdAt,
    ),
  }),
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
