-- ============================================================
-- Migration 0008 — discounts / vouchers
-- Handgeschreven conform Drizzle-conventie (db:generate kan de ESM-imports niet
-- resolven). PUUR ADDITIEF — bestaande tabellen worden NOOIT aangeraakt.
-- `set_updated_at()` bestaat al uit 0000.
--
-- 2 nieuwe tabellen: discounts, discount_redemptions.
-- ============================================================

-- ─── discounts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "discounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "shop_id" uuid REFERENCES "shops"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "value" numeric(12, 4) DEFAULT '0' NOT NULL,
  "currency" text DEFAULT 'EUR' NOT NULL,
  "min_subtotal" numeric(12, 4),
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "max_redemptions" integer,
  "max_per_customer" integer,
  "times_redeemed" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- UNIQUE(shop_id, code): per shop is een code uniek. NB: Postgres telt NULL als
-- distinct, dus meerdere globale codes met dezelfde tekst worden hier NIET
-- geblokkeerd — de route-laag pre-checkt dat (409 duplicate_code).
-- Wrapped in DO-block zodat de migratie herhaalbaar is (ADD CONSTRAINT kent geen
-- IF NOT EXISTS in oudere Postgres-versies).
DO $$ BEGIN
  ALTER TABLE "discounts"
    ADD CONSTRAINT "discounts_shop_code_unique" UNIQUE ("shop_id", "code");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "discounts_code_idx" ON "discounts" ("code");

-- ─── discount_redemptions (append-only) ──────────────────────
CREATE TABLE IF NOT EXISTS "discount_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "discount_id" uuid NOT NULL REFERENCES "discounts"("id") ON DELETE CASCADE,
  "order_id" uuid,
  "customer_email" text,
  "amount_applied" numeric(12, 4) DEFAULT '0' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "discount_redemptions_discount_idx"
  ON "discount_redemptions" ("discount_id");
CREATE INDEX IF NOT EXISTS "discount_redemptions_order_idx"
  ON "discount_redemptions" ("order_id");

-- ════════════════════════════════════════════════════════════
-- updated_at-trigger (gebruikt bestaande set_updated_at() uit 0000).
-- Alleen `discounts` heeft updated_at; discount_redemptions is append-only.
-- DROP-then-CREATE houdt de migratie herhaalbaar.
-- ════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS discounts_updated_at ON "discounts";
CREATE TRIGGER discounts_updated_at
  BEFORE UPDATE ON "discounts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
