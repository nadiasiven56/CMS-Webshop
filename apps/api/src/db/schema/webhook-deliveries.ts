import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { webhooks } from './webhooks.js';

/**
 * Webhook delivery-log (append-only). Eén rij per afleverpoging van een
 * outbound webhook (of een ad-hoc test-fire zonder webhook-row, dan is
 * `webhook_id` null). De dispatcher schrijft hier altijd een rij — geslaagd of
 * niet — zodat de delivery-historie volledig terug te zien is.
 *
 * `webhook_id` → webhooks.id ON DELETE CASCADE: verwijder je de webhook, dan
 * verdwijnt zijn historie mee. Nullable zodat een ad-hoc test-fire (alleen
 * {event,url,secret}) ook gelogd kan worden.
 *
 * `payload` = de exacte JSON-body die verstuurd is (na stable stringify, weer
 * geparsed naar jsonb). `request_headers` = de headers die we meestuurden
 * (Content-Type / X-Webshop-Event; NOOIT de signature-secret zelf). `response_body`
 * is getrunceerd opgeslagen (zie dispatcher). Geen `updated_at` — dit is een log.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookId: uuid('webhook_id').references(() => webhooks.id, {
      onDelete: 'cascade',
    }),
    event: text('event').notNull(),
    url: text('url').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    requestHeaders: jsonb('request_headers').$type<Record<string, string> | null>(),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    success: boolean('success').notNull().default(false),
    attempt: integer('attempt').notNull().default(1),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    webhookIdx: index('webhook_deliveries_webhook_idx').on(t.webhookId),
    eventIdx: index('webhook_deliveries_event_idx').on(t.event),
  }),
);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
