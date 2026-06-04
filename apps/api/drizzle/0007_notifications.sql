-- ============================================================
-- Migration 0007 — transactionele e-mail (notifications)
-- Handgeschreven conform Drizzle-conventie. PUUR ADDITIEF — bestaande tabellen
-- worden NOOIT aangeraakt. `set_updated_at()` bestaat al uit 0000.
--
-- 3 nieuwe tabellen: email_provider_config, email_templates, email_log.
-- ============================================================

-- ─── email_provider_config ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_provider_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'disconnected' NOT NULL,
  "credentials" jsonb,
  "config" jsonb DEFAULT '{}' NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "last_test_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ─── email_templates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "subject" text NOT NULL,
  "body_html" text NOT NULL,
  "body_text" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "locale" text DEFAULT 'nl' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "email_templates_key_unique" UNIQUE ("key")
);

-- ─── email_log (append-only) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_key" text,
  "to_email" text NOT NULL,
  "subject" text NOT NULL,
  "status" text NOT NULL,
  "provider" text,
  "error" text,
  "order_id" uuid,
  "raw" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "email_log_to_email_idx" ON "email_log" ("to_email");
CREATE INDEX IF NOT EXISTS "email_log_order_id_idx" ON "email_log" ("order_id");

-- ════════════════════════════════════════════════════════════
-- updated_at-triggers (gebruikt bestaande set_updated_at() uit 0000)
-- email_log is append-only → GEEN trigger.
-- DROP-then-CREATE houdt de migratie herhaalbaar (CREATE TRIGGER kent geen
-- IF NOT EXISTS in oudere Postgres-versies).
-- ════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS email_provider_config_updated_at ON "email_provider_config";
CREATE TRIGGER email_provider_config_updated_at
  BEFORE UPDATE ON "email_provider_config"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS email_templates_updated_at ON "email_templates";
CREATE TRIGGER email_templates_updated_at
  BEFORE UPDATE ON "email_templates"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
