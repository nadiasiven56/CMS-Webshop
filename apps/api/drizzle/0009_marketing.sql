-- ============================================================
-- Migration 0009 — Wave-M: marketing feeds + storefront analytics.
-- Puur additief. 2 nieuwe tabellen, geen bestaande kolom aangeraakt.
-- ============================================================

-- ─── storefront_analytics ────────────────────────────────────
-- Per shop EXACT 1 rij (UNIQUE shop_id). Publieke client-side tag-ids.
CREATE TABLE IF NOT EXISTS "storefront_analytics" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"                     uuid NOT NULL,
  "ga4_measurement_id"          text,
  "meta_pixel_id"               text,
  "google_ads_id"               text,
  "google_ads_conversion_label" text,
  "custom_head_html"            text,
  "enabled"                     boolean NOT NULL DEFAULT true,
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "updated_at"                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "storefront_analytics_shop_id_unique" UNIQUE ("shop_id"),
  CONSTRAINT "storefront_analytics_shop_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE
);

-- ─── feed_config ─────────────────────────────────────────────
-- Per (shop, channel) 1 rij. channel = 'google_shopping' | 'meta'.
CREATE TABLE IF NOT EXISTS "feed_config" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"              uuid NOT NULL,
  "channel"              text NOT NULL,
  "enabled"              boolean NOT NULL DEFAULT true,
  "include_out_of_stock" boolean NOT NULL DEFAULT false,
  "currency"             text NOT NULL DEFAULT 'EUR',
  "config"               jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_built_at"        timestamptz,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "feed_config_shop_channel_unique" UNIQUE ("shop_id", "channel"),
  CONSTRAINT "feed_config_shop_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE
);

-- Lookup-index voor de publieke feed-routes (per shop).
CREATE INDEX IF NOT EXISTS "feed_config_shop_id_idx" ON "feed_config" ("shop_id");
