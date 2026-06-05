-- ============================================================
-- Migration 0012 — Microsoft Clarity project-id op storefront_analytics.
-- Puur additief. 1 nieuwe nullable kolom, geen bestaande kolom aangeraakt.
-- Idempotent (IF NOT EXISTS) zodat herhaald draaien veilig is.
-- ============================================================

ALTER TABLE "storefront_analytics"
  ADD COLUMN IF NOT EXISTS "clarity_project_id" text;
