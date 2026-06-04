-- ============================================================
-- Migration 0010 — webhook_deliveries (outbound-webhook delivery-log)
-- Handgeschreven conform Drizzle-conventie. PUUR ADDITIEF — bestaande tabellen
-- (incl. webhooks uit 0002) worden NOOIT aangeraakt.
--
-- 1 nieuwe tabel: webhook_deliveries (append-only). FK → webhooks ON DELETE CASCADE,
-- nullable (ad-hoc test-fire zonder webhook-row). Geen updated_at / trigger.
-- ============================================================

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "webhook_id" uuid REFERENCES "webhooks"("id") ON DELETE CASCADE,
  "event" text NOT NULL,
  "url" text NOT NULL,
  "payload" jsonb,
  "request_headers" jsonb,
  "response_status" integer,
  "response_body" text,
  "success" boolean DEFAULT false NOT NULL,
  "attempt" integer DEFAULT 1 NOT NULL,
  "error_message" text,
  "duration_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_idx"
  ON "webhook_deliveries" ("webhook_id");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_event_idx"
  ON "webhook_deliveries" ("event");
