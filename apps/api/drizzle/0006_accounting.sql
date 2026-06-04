-- ============================================================
-- Migration 0006 — accounting-sync (Moneybird / Exact / e-Boekhouden)
-- Handgeschreven conform Drizzle-conventie (db:generate kan ESM-imports niet
-- resolven). PUUR ADDITIEF — bestaande tabellen worden NOOIT aangeraakt.
-- `set_updated_at()` bestaat al uit 0000.
--
-- 2 nieuwe tabellen: accounting_connections, accounting_sync_log.
-- ============================================================

-- ─── accounting_connections ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "accounting_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'disconnected' NOT NULL,
  "credentials" jsonb,
  "config" jsonb DEFAULT '{}' NOT NULL,
  "last_sync_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ─── accounting_sync_log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "accounting_sync_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL REFERENCES "accounting_connections"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" uuid,
  "external_id" text,
  "status" text NOT NULL,
  "message" text,
  "raw" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "accounting_sync_log_connection_idx"
  ON "accounting_sync_log" ("connection_id");

-- ════════════════════════════════════════════════════════════
-- updated_at-trigger (gebruikt bestaande set_updated_at() uit 0000)
-- Alleen accounting_connections heeft updated_at; sync_log is append-only.
-- DROP-then-CREATE houdt de migratie herhaalbaar (CREATE TRIGGER kent geen
-- IF NOT EXISTS in oudere Postgres-versies).
-- ════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS accounting_connections_updated_at ON "accounting_connections";
CREATE TRIGGER accounting_connections_updated_at
  BEFORE UPDATE ON "accounting_connections"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
