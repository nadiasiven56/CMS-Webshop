import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Transactionele-email module — CONNECT-READY.
 *
 * Stuurt transactionele mails (order-bevestiging / verzending / refund / return
 * / welkom) via een pluggable email-provider (smtp/postmark/sendgrid/mailgun).
 * `credentials` wordt encrypted opgeslagen (channel-crypto, shape `{ enc }`),
 * exact zoals `channels.credentials`. Niets vuurt live zonder credentials — de
 * adapters guarden elke netwerk-call achter een `requireCreds()`-check en de
 * publieke `sendNotification(...)`-service logt + skipt netjes zolang er geen
 * actieve, connected provider is.
 *
 * Single-active-provider-model: meerdere rows mogen bestaan, maar exact één is
 * `isActive=true`. De send-service kiest de actieve, connected provider.
 */
export const emailProviderConfig = pgTable('email_provider_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(), // smtp | postmark | sendgrid | mailgun
  name: text('name').notNull(),
  status: text('status').notNull().default('disconnected'),
  // disconnected | connected | error
  credentials: jsonb('credentials').$type<Record<string, unknown> | null>(),
  // Vrij config-blob: fromEmail, fromName, replyTo, mailgunDomain,
  // smtpHost/smtpPort/smtpSecure etc.
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean('is_active').notNull().default(false),
  lastTestAt: timestamp('last_test_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EmailProviderConfig = typeof emailProviderConfig.$inferSelect;
export type NewEmailProviderConfig = typeof emailProviderConfig.$inferInsert;

/**
 * Email-templates. `key` is functioneel uniek (order_confirmation /
 * order_shipped / ...). Body's gebruiken een tiny `{{var}}`-mustache-stijl die de
 * send-service rendert. `locale` houdt de taal vast (default 'nl').
 */
export const emailTemplates = pgTable('email_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  // order_confirmation | order_shipped | order_refunded | return_received |
  // welcome | ...
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  bodyHtml: text('body_html').notNull(),
  bodyText: text('body_text'),
  enabled: boolean('enabled').notNull().default(true),
  locale: text('locale').notNull().default('nl'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;

/**
 * Email-log (append-only). Eén rij per verstuur-poging. `status`:
 *   - queued              : klaargezet (provider-call gestart)
 *   - sent                : provider accepteerde de mail
 *   - failed              : provider gaf een fout
 *   - skipped_no_provider : geen actieve connected provider — KOPPEL-KLAAR gedrag
 * Geen `updated_at` — dit is een log, niet een muteerbare rij.
 */
export const emailLog = pgTable(
  'email_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateKey: text('template_key'),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    status: text('status').notNull(),
    // queued | sent | failed | skipped_no_provider
    provider: text('provider'),
    error: text('error'),
    orderId: uuid('order_id'),
    raw: jsonb('raw').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    toEmailIdx: index('email_log_to_email_idx').on(t.toEmail),
    orderIdIdx: index('email_log_order_id_idx').on(t.orderId),
  }),
);

export type EmailLog = typeof emailLog.$inferSelect;
export type NewEmailLog = typeof emailLog.$inferInsert;
