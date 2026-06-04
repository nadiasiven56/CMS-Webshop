import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { locations } from './locations.js';

/**
 * Multi-shop tenant-as. Elke eigen webshop/merk. Gedeelde catalogus/voorraad,
 * eigen storefront/branding/btw-config. Alle CMS/commerce/financieel hangt
 * (direct of indirect) aan een shop.
 */
export type ShopBranding = {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  font?: string;
  theme?: string;
};

export type ShopVatConfig = {
  priceIncludesVat?: boolean;
  defaultCountry?: string; // ISO-2
  oss?: boolean;
};

export const shops = pgTable('shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(), // 'crema', 'pawfect'
  name: text('name').notNull(),
  domain: text('domain').unique(), // 'crema.nl' (nullable in dev)
  locale: text('locale').notNull().default('nl-NL'),
  currency: text('currency').notNull().default('EUR'),
  status: text('status').notNull().default('active'), // active | draft | paused
  // Publishable storefront-token (à la Shopify X-Shopify-Storefront-Access-Token /
  // Medusa x-publishable-api-key). We slaan ALLEEN de sha256-hash van het token op,
  // nooit de raw waarde. Nullable: een shop hoeft (nog) geen token te hebben.
  storefrontTokenHash: text('storefront_token_hash'),
  branding: jsonb('branding').$type<ShopBranding>().notNull().default({}),
  vatConfig: jsonb('vat_config').$type<ShopVatConfig>().notNull().default({}),
  defaultLocationId: uuid('default_location_id').references(() => locations.id, {
    onDelete: 'set null',
  }),
  supportEmail: text('support_email'),
  // ─── Wave-H A4 — pluggable payments (0004_payment_config) ───
  // PSP key: 'mollie' (null = no provider → checkout keeps the mock-paid path).
  paymentProvider: text('payment_provider'),
  // Encrypted `{ enc }` blob (channel-crypto AES-256-GCM) holding the PSP key,
  // shape `{ apiKey: 'test_…' | 'live_…' }`. NOOIT raw teruggeven.
  paymentCredentials: jsonb('payment_credentials').$type<{ enc: string } | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
