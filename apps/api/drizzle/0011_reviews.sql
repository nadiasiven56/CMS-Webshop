-- ============================================================
-- Migration 0011 — reviews (Kiyoh / Trustpilot / Google)
-- Handgeschreven conform Drizzle-conventie. PUUR ADDITIEF — bestaande tabellen
-- worden NOOIT aangeraakt. `set_updated_at()` bestaat al uit 0000.
--
-- 3 nieuwe tabellen: review_sources, reviews, review_invitations.
-- ============================================================

-- ─── review_sources ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "review_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'disconnected' NOT NULL,
  "credentials" jsonb,
  "config" jsonb DEFAULT '{}' NOT NULL,
  "last_fetch_at" timestamp with time zone,
  "rating_average" numeric(3, 2),
  "rating_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ─── reviews ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_id" uuid NOT NULL,
  "external_id" text,
  "provider" text,
  "rating" integer,
  "title" text,
  "body" text,
  "author_name" text,
  "product_id" uuid,
  "order_id" uuid,
  "published_at" timestamp with time zone,
  "raw" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reviews_source_external_unique" UNIQUE ("source_id", "external_id")
);

-- reviews.source_id → review_sources.id (cascade delete)
DO $$ BEGIN
  ALTER TABLE "reviews"
    ADD CONSTRAINT "reviews_source_id_review_sources_id_fk"
    FOREIGN KEY ("source_id") REFERENCES "review_sources"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── review_invitations (append-only log) ────────────────────
CREATE TABLE IF NOT EXISTS "review_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_id" uuid,
  "order_id" uuid,
  "email" text,
  "status" text NOT NULL,
  "provider" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- review_invitations.source_id → review_sources.id (set null on delete:
-- de log blijft behouden ook als de source verwijderd wordt)
DO $$ BEGIN
  ALTER TABLE "review_invitations"
    ADD CONSTRAINT "review_invitations_source_id_review_sources_id_fk"
    FOREIGN KEY ("source_id") REFERENCES "review_sources"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "review_invitations_order_id_idx"
  ON "review_invitations" ("order_id");

-- ════════════════════════════════════════════════════════════
-- updated_at-triggers (gebruikt bestaande set_updated_at() uit 0000)
-- review_invitations is append-only → GEEN trigger.
-- DROP-then-CREATE houdt de migratie herhaalbaar (CREATE TRIGGER kent geen
-- IF NOT EXISTS in oudere Postgres-versies).
-- ════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS review_sources_updated_at ON "review_sources";
CREATE TRIGGER review_sources_updated_at
  BEFORE UPDATE ON "review_sources"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS reviews_updated_at ON "reviews";
CREATE TRIGGER reviews_updated_at
  BEFORE UPDATE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
