import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { orders } from './orders.js';

/**
 * Verzend-carrier (sendcloud/myparcel/postnl/dhl). `credentials` wordt encrypted
 * opgeslagen (via CHANNEL_SECRET_KEY door channel-crypto). Spiegelt de
 * `channels`-tabel — koppel-klaar: niets vuurt zonder credentials.
 *
 * code is UNIQUE — er is precies één carrier per provider-code.
 */
export const shippingCarriers = pgTable('shipping_carriers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // sendcloud | myparcel | postnl | dhl
  name: text('name').notNull(),
  status: text('status').notNull().default('disconnected'), // disconnected | connected | error
  credentials: jsonb('credentials').$type<Record<string, unknown> | null>(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  lastTestAt: timestamp('last_test_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ShippingCarrier = typeof shippingCarriers.$inferSelect;
export type NewShippingCarrier = typeof shippingCarriers.$inferInsert;

/**
 * Verzending voor een order. Eén order kan meerdere shipments hebben (deel- of
 * herzendingen). `raw` bewaart de carrier-payload (label-create / tracking).
 * Carrier-link is set-null zodat een carrier verwijderen de shipment-historie
 * niet wist; `carrierCode` blijft als snapshot staan.
 *
 * INDEX(order_id) — non-unique, voor het ophalen van shipments per order.
 */
export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id').references(() => shippingCarriers.id, {
      onDelete: 'set null',
    }),
    carrierCode: text('carrier_code'),
    trackingCode: text('tracking_code'),
    trackingUrl: text('tracking_url'),
    labelUrl: text('label_url'),
    status: text('status').notNull().default('pending'),
    // pending | label_created | in_transit | delivered | error
    weightGrams: integer('weight_grams'),
    raw: jsonb('raw').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdIdx: index('shipments_order_id_idx').on(t.orderId),
  }),
);

export type Shipment = typeof shipments.$inferSelect;
export type NewShipment = typeof shipments.$inferInsert;
