-- Bootstrap-extensions voor Webshop-CRM
-- Wordt 1x uitgevoerd door Postgres-image bij eerste container-init.
-- Idempotent: gebruikt IF NOT EXISTS.

-- gen_random_uuid() voor primary keys
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Optioneel: full-text search varianten (komt in latere fase)
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE EXTENSION IF NOT EXISTS unaccent;
