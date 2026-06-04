import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Reviews-module — CONNECT-READY (Kiyoh / Trustpilot / Google).
 *
 * Verbindt een review-provider, verstuurt review-uitnodigingen na orders en
 * haalt reviews op om als trust-signal in de storefront te tonen (rating-
 * samenvatting + recente reviews). `credentials` wordt encrypted opgeslagen
 * (channel-crypto, shape `{ enc }`), exact zoals `channels.credentials`. Niets
 * vuurt live zonder credentials — de adapters guarden elke netwerk-call achter
 * een `requireCreds()`-check en de publieke `requestReviewInvitation(...)`-
 * service logt + skipt netjes zolang er geen actieve, connected source is.
 *
 * 3 tabellen:
 *   - review_sources      : per-provider connectie + rating-samenvatting
 *   - reviews             : opgehaalde reviews, idempotent op (source, external)
 *   - review_invitations  : append-only log van verstuurde uitnodigingen
 */
export const reviewSources = pgTable('review_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(), // kiyoh | trustpilot | google
  name: text('name').notNull(),
  status: text('status').notNull().default('disconnected'),
  // disconnected | connected | error
  credentials: jsonb('credentials').$type<Record<string, unknown> | null>(),
  // Vrij config-blob: locationId (kiyoh), businessUnitId (trustpilot),
  // accountId/locationId (google), etc.
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  lastFetchAt: timestamp('last_fetch_at', { withTimezone: true }),
  ratingAverage: numeric('rating_average', { precision: 3, scale: 2 }),
  ratingCount: integer('rating_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ReviewSource = typeof reviewSources.$inferSelect;
export type NewReviewSource = typeof reviewSources.$inferInsert;

/**
 * Opgehaalde review vanaf een source. `raw` bewaart de originele payload.
 * UNIQUE(source_id, external_id) → idempotente upsert per fetch.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => reviewSources.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    provider: text('provider'),
    rating: integer('rating'),
    title: text('title'),
    body: text('body'),
    authorName: text('author_name'),
    productId: uuid('product_id'),
    orderId: uuid('order_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    raw: jsonb('raw').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceExternalUnique: unique('reviews_source_external_unique').on(
      t.sourceId,
      t.externalId,
    ),
  }),
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;

/**
 * Review-uitnodiging-log (append-only). Eén rij per uitnodigings-poging.
 * `status`:
 *   - queued                 : klaargezet (adapter-call gestart)
 *   - sent                   : provider accepteerde de uitnodiging
 *   - skipped_not_connected  : geen actieve connected source — KOPPEL-KLAAR gedrag
 *   - error                  : adapter gaf een fout
 * Geen `updated_at` — dit is een log, niet een muteerbare rij.
 */
export const reviewInvitations = pgTable(
  'review_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => reviewSources.id, {
      onDelete: 'set null',
    }),
    orderId: uuid('order_id'),
    email: text('email'),
    status: text('status').notNull(),
    // queued | sent | skipped_not_connected | error
    provider: text('provider'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdIdx: index('review_invitations_order_id_idx').on(t.orderId),
  }),
);

export type ReviewInvitation = typeof reviewInvitations.$inferSelect;
export type NewReviewInvitation = typeof reviewInvitations.$inferInsert;
