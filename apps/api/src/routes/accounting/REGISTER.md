# REGISTER — accounting (`routes/accounting/`)

**Atlas — accounting-sync module (koppel-klaar).** Strikt binnen:
- `apps/api/src/routes/accounting/**` (nieuw)
- `apps/api/src/db/schema/accounting.ts` (nieuw)
- `apps/api/src/db/seed-accounting.ts` (nieuw)

Geen andere folders aangeraakt. `routes/index.ts`, `db/schema/index.ts`, `db/seed.ts`, `lib/env.ts` en de migrations worden door de **orchestrator/finalizer** gewired — instructies hieronder.

De channels-module is exact als blueprint gevolgd (adapter-registry + requireCreds-guard + encrypted/masked creds + runInTransactionWithAudit + idempotente seed).

---

## 1. Mount (orchestrator voegt toe aan `routes/index.ts`)

```ts
// import (boven `export const apiRoutes` / bij de andere feature-routers)
import { accountingRoutes } from './accounting/index.js';

// op het feature-agent registration slot
apiRoutes.route('/accounting', accountingRoutes);
```

Alle endpoints zitten al achter `requireAuth` (`accountingRoutes.use('*', requireAuth)` staat in de router zelf) — geen extra middleware nodig.

## 2. Schema-export (orchestrator voegt toe aan `db/schema/index.ts`)

```ts
// ─── Boekhouding (accounting-sync) ───────────────────────────
export * from './accounting.js';
```

(Plaats logisch onder het bestaande `// ─── Financieel ───` / `// ─── Channels ───`-blok.)

## 3. Seed-hook (orchestrator hangt aan de seed-flow)

Nieuw bestand `apps/api/src/db/seed-accounting.ts` exporteert `seedAccounting()` (idempotent — checkt per provider op bestaan, mirrort `seedChannels()`).

In `apps/api/src/db/seed.ts`:

```ts
import { seedAccounting } from './seed-accounting.js';
// ... binnen main(), na seedChannels():
await seedAccounting();
```

Of los draaien:
`pnpm --filter @webshop-crm/api exec tsx src/db/seed-accounting.ts`
(het bestand heeft een eigen CLI-entry die alleen draait bij directe uitvoer.)

Seedt 3 koppelingen als `disconnected`: **moneybird** (Moneybird), **exact** (Exact Online), **eboekhouden** (e-Boekhouden). Geen credentials.

## 4. Env vars (allemaal OPTIONEEL — geen wijziging aan `lib/env.ts` nodig)

Deze module hergebruikt `CHANNEL_SECRET_KEY` (bestaat al in `lib/env.ts`) voor credential-encryptie via `lib/channel-crypto.ts`. Er zijn **geen nieuwe verplichte env vars**.

Per-provider OAuth/credential-waarden worden NIET uit env gelezen maar per koppeling via `PUT /connections/:id/credentials` ingevoerd en encrypted opgeslagen. Wil de orchestrator later defaults/registratie-app-keys via env aanbieden, dan zijn dit logische (optionele) namen — nu niet vereist:

```
# OPTIONEEL — niet gelezen door deze module; alleen als de orchestrator later
# OAuth-app-registraties centraal wil bewaren i.p.v. per-koppeling invoeren.
MONEYBIRD_CLIENT_ID=
MONEYBIRD_CLIENT_SECRET=
EXACT_CLIENT_ID=
EXACT_CLIENT_SECRET=
EBOEKHOUDEN_API_BASE=
```

## 5. Migration (handgeschreven — volg de 0001/0002-conventie)

Nieuw bestand: `apps/api/drizzle/0005_accounting_sync.sql`. Puur additief, `CREATE TABLE IF NOT EXISTS`, hergebruikt de bestaande `set_updated_at()`-functie (uit 0000). Daarna `pnpm --filter @webshop-crm/api db:migrate`.

```sql
-- ============================================================
-- Migration 0005 — accounting-sync (Moneybird / Exact / e-Boekhouden)
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
```

---

## Endpoints (allemaal `/api/accounting/*`, achter `requireAuth`)

| Method | Path | Beschrijving |
|---|---|---|
| GET    | `/connections`                       | List koppelingen (filter `?provider=&status=`, paginated). Masked creds + sync-log counts. |
| POST   | `/connections`                       | Create. Body `{provider, name, config?}`. Start `disconnected`. |
| GET    | `/connections/:id`                   | Detail (masked creds + counts). |
| PATCH  | `/connections/:id`                   | Partial update `{name?, config?, status?}`. |
| DELETE | `/connections/:id`                   | Delete (cascade `accounting_sync_log`). |
| PUT    | `/connections/:id/credentials`       | Encrypt + store creds (per-provider zod-schema). 422 bij onbekende provider. |
| POST   | `/connections/:id/test-connection`   | Decrypt in-memory → `verifyConnection` (never-throws) → persist status (`connected`/`error`). |
| POST   | `/connections/:id/sync`              | Push facturen/orders. Body `{scope:'invoices'\|'orders', from?, to?}`. 409 `accounting_not_connected` als niet connected. Idempotent (skip entiteiten met sync-log status `synced`). Schrijft een sync-log-rij per entiteit + zet `lastSyncAt`. |
| GET    | `/connections/:id/sync-log`          | Append-log paginated (`?status=&entityType=&limit=&offset=`). |

### Providers + credential-shapes (encrypted opgeslagen, nooit raw terug)
- **moneybird** — Bearer OAuth. Creds `{accessToken}`, config `{administrationId}`. Base `https://moneybird.com/api/v2/{administration_id}`, POST `/sales_invoices.json`.
- **exact** — Bearer OAuth2. Creds `{accessToken, refreshToken, clientId, clientSecret}`, config `{division}`. Base `https://start.exactonline.nl/api/v1/{division}`, POST `/salesentry/SalesEntries`.
- **eboekhouden** — session-token. Creds `{username, securityCode1, securityCode2}`. Base REST `https://api.e-boekhouden.nl` (legacy SOAP `https://soap.e-boekhouden.nl`), POST `/v1/invoice` na session-open.

## Conventies bevestigd
- **Koppel-klaar**: elke netwerk-call zit achter `requireCreds()` die een typed `AccountingNotConnectedError` (`error='accounting_not_connected'`) gooit zolang `status !== 'connected'` of creds leeg zijn. `verifyConnection` throwt NOOIT (geeft `{ok:false}`). Niets vuurt live zonder credentials.
- **Geld = string** (numeric → string, nooit float); per-line `unitPriceString` / `vatRateString` + totals als string.
- **Creds encrypted + masked** via `lib/channel-crypto.ts` (`encryptCredentials`/`decryptCredentials`/`maskCredentials`) — hergebruik, geen nieuwe crypto.
- **Mutations** via `runInTransactionWithAudit` met `entityType='accounting_connection'`.
- **Finance is read-only**: facturen/orders worden gelezen uit de bestaande `invoices` / `orders` + `order_items` tabellen; deze module muteert die NOOIT.
- **Idempotente seed** (check-per-provider, mirror seedChannels).

## Schema-afhankelijkheden (READ-ONLY)
- `invoices` (`Invoice`): velden `id, invoiceNumber, issuedAt, customer{name,company,email,address{line1,line2,postcode,city,country}}, lines (jsonb: {title,sku,quantity,unitPrice,taxRate}), subtotal, vatTotal, total`.
- `orders` (`Order`): `id, orderNumber, email, currency, placedAt, createdAt, subtotal, taxTotal, grandTotal, billingAddress{name,company,line1,...}`.
- `order_items` (`OrderItem`): `orderId, sku, title, quantity, unitPrice, taxRate`.

## Typecheck
`src/routes/accounting/**` + `src/db/schema/accounting.ts` + `src/db/seed-accounting.ts` compileren schoon (geen nieuwe TS-errors). Pre-bestaande errors in `domain/finance/ubl.ts`, `domain/products/slug-unique.ts`, `domain/stock/transaction-helpers.ts` en diverse `__tests__` staan los van deze module (bestonden al). Let op: `db:generate` werkt niet in deze repo (drizzle-kit kan de ESM `.js`-imports niet resolven) — daarom de handgeschreven migratie hierboven.
