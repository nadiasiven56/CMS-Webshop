# REGISTER — reviews (`routes/reviews/`)

**Atlas — reviews-module (Kiyoh / Trustpilot / Google), koppel-klaar.** Strikt binnen:
- `apps/api/src/routes/reviews/**` (nieuw)
- `apps/api/src/domain/reviews/**` (nieuw — invitation-service, importeerbaar)
- `apps/api/src/db/schema/reviews.ts` (nieuw)
- `apps/api/src/db/seed-reviews.ts` (nieuw)

Geen andere folders aangeraakt. `routes/index.ts`, `db/schema/index.ts`, `db/seed.ts`, `lib/env.ts` en de migrations worden door de **orchestrator/finalizer** gewired — instructies hieronder.

De channels- + notifications-modules zijn exact als blueprint gevolgd (adapter-registry + requireCreds-guard + encrypted/masked creds via `lib/channel-crypto.ts` + `runInTransactionWithAudit` + idempotente upsert + idempotente seed + never-throw verify + never-throw invite).

---

## 1. Mount (orchestrator voegt toe aan `routes/index.ts`)

```ts
// import (bij de andere feature-routers)
import { reviewRoutes } from './reviews/index.js';

// op het feature-agent registration slot
apiRoutes.route('/reviews', reviewRoutes);
```

Alle endpoints zitten al achter `requireAuth` (`reviewRoutes.use('*', requireAuth)` staat in de router zelf) — geen extra middleware nodig.

## 2. Schema-export (orchestrator voegt toe aan `db/schema/index.ts`)

```ts
// ─── Reviews (Kiyoh / Trustpilot / Google) ───────────────────
export * from './reviews.js';
```

(Plaats logisch onder het bestaande `// ─── Webhooks ───`-blok.)

## 3. Seed-hook (orchestrator hangt aan de seed-flow)

Nieuw bestand `apps/api/src/db/seed-reviews.ts` exporteert `seedReviews()` (idempotent — check-per-provider, mirror `seedChannels()`/`seedNotifications()`).

In `apps/api/src/db/seed.ts`:

```ts
import { seedReviews } from './seed-reviews.js';
// ... binnen main(), na seedChannels()/seedNotifications():
await seedReviews();
```

Of los draaien:
`pnpm --filter @webshop-crm/api exec tsx src/db/seed-reviews.ts`
(het bestand heeft een eigen CLI-entry die alleen draait bij directe uitvoer.)

Seedt 3 review-sources (`kiyoh`, `trustpilot`, `google`) als `disconnected`, zonder credentials.

## 4. Env vars (allemaal OPTIONEEL — geen wijziging aan `lib/env.ts` nodig)

Deze module hergebruikt `CHANNEL_SECRET_KEY` (bestaat al in `lib/env.ts`) voor credential-encryptie via `lib/channel-crypto.ts`. Er zijn **geen nieuwe verplichte env vars**.

Per-provider API-keys/tokens worden NIET uit env gelezen maar per source via `PUT /sources/:id/credentials` ingevoerd en encrypted opgeslagen. Wil de orchestrator later defaults via env aanbieden, dan zijn dit logische (optionele) namen — nu niet vereist:

```
# OPTIONEEL — niet gelezen door deze module; alleen als de orchestrator later
# review-provider-keys centraal wil bewaren i.p.v. per-source invoeren.
KIYOH_API_HASH=
KIYOH_LOCATION_ID=
TRUSTPILOT_API_KEY=
TRUSTPILOT_API_SECRET=
TRUSTPILOT_BUSINESS_UNIT_ID=
GOOGLE_ACCESS_TOKEN=
GOOGLE_ACCOUNT_ID=
GOOGLE_LOCATION_ID=
```

## 5. Migration (handgeschreven — volg de 0001..0004-conventie)

Nieuw bestand: `apps/api/drizzle/<NNNN>_reviews.sql` (kies het eerstvolgende vrije nummer — op schijf is `0004` het hoogste, maar shipping/accounting/notifications claimen mogelijk `0005`/`0006`; gebruik het volgende vrije nummer in de keten). Puur additief, `CREATE TABLE IF NOT EXISTS`, hergebruikt de bestaande `set_updated_at()`-functie (uit 0000). Daarna `pnpm --filter @webshop-crm/api db:migrate`.

> Let op: `db:generate` werkt niet in deze repo (drizzle-kit 0.28.1 kan de ESM `.js`-imports niet resolven) — daarom de handgeschreven migratie, net als bij 0001–0004.

```sql
-- ============================================================
-- Migration <NNNN> — reviews (Kiyoh / Trustpilot / Google)
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
```

---

## 6. Publieke service voor het order-delivered event — `requestReviewInvitation(...)`

**DIT is het integratie-contract.** De orchestrator wire de echte trigger in het order-delivered event (orders-module) door deze service aan te roepen. De service leeft bewust onder `domain/` (geen route-dependency).

**Import-pad (vanuit `domain/orders/...`):**

```ts
import { requestReviewInvitation } from '../reviews/invite.js';
// (vanuit routes/* zou het pad zijn: '../../domain/reviews/invite.js')
```

**Signature:**

```ts
function requestReviewInvitation(opts: {
  email: string;                 // recipient email
  orderId?: string;              // optioneel — correleert de invitation-log-rij
  name?: string;                 // optioneel — display-name doorgegeven aan provider
}): Promise<{ status: string; invitationId: string }>;
// status ∈ 'sent' | 'error' | 'skipped_not_connected'
```

**Voorbeeld-wiring (orchestrator, later — bij order-delivered):**

```ts
// nadat een order op 'delivered' is gezet:
await requestReviewInvitation({
  email: order.email,
  orderId: order.id,
  name: customerName,
});
```

**KOPPEL-KLAAR / NEVER-THROW-garantie:** `requestReviewInvitation` gooit NOOIT naar de caller. Als er geen actieve, `connected` review-source is → schrijft een `review_invitations`-rij met status `skipped_not_connected` en returnt (de order-flow breekt dus nooit op ontbrekende review-config). Bij een adapter-fout → `error` met `error`-tekst. Er wordt ALTIJD precies één invitation-log-rij geschreven. Mirror van het notifications `sendNotification`-contract.

> Google heeft geen invitation-API: `sendInvitation` op de Google-adapter returnt een `not_supported` raw-note zonder te breken. Als de actieve source `google` is, wordt de invitation dus als `sent` gelogd (provider accepteerde de no-op) — de fetch-kant (rating-summary) blijft wel volledig werkend.

---

## Endpoints (allemaal `/api/reviews/*`, achter `requireAuth`)

| Method | Path | Beschrijving |
|---|---|---|
| GET    | `/sources`                          | List sources (filter `?provider=&status=`, paginated). Masked creds + rating-summary. |
| POST   | `/sources`                          | Create. Body `{provider, name, config?}`. Start `disconnected`. |
| GET    | `/sources/:id`                      | Detail (masked creds). |
| PATCH  | `/sources/:id`                      | Partial update `{name?, config?, status?}`. |
| DELETE | `/sources/:id`                      | Delete (cascade `reviews`; `review_invitations.source_id`→null). |
| PUT    | `/sources/:id/credentials`          | Encrypt + store creds (per-provider zod-schema). 422 bij onbekende provider. |
| POST   | `/sources/:id/test-connection`      | Decrypt in-memory → `verifyConnection` (never-throws) → persist status (`connected`/`error`). |
| POST   | `/sources/:id/fetch`                | `fetchReviews` (guarded) → idempotente upsert op (source,external) + update `rating_average`/`rating_count`/`last_fetch_at`. **409 `review_source_not_connected`** als niet connected; 502 bij andere adapter-fout. |
| GET    | `/sources/:id/reviews?limit=&offset=` | Opgeslagen reviews voor een source (nieuwste eerst). |
| GET    | `/summary?source_id=`               | Aggregatie van OPGESLAGEN reviews: `count`, `rated`, `average`, `distribution` (1..5 sterren). Optioneel per source. |
| POST   | `/invite`                           | Body `{email, orderId?, name?}` → `requestReviewInvitation`. Geen connected source → `skipped_not_connected` + duidelijke message (nooit 500). |

### Providers + credential-shapes (encrypted opgeslagen, nooit raw terug)
- **kiyoh** — header `X-Publication-Api-Token: {apiHash}` + `locationId` query, base `https://www.kiyoh.com/v1/`. Invite: `POST /v1/invitation`. Feed+summary: `GET /v1/publication/review/external?locationId={id}`. Creds `{apiHash}`, config `{locationId}`.
- **trustpilot** — OAuth2 client-credentials (`Basic base64(apiKey:apiSecret)` → Bearer, token in-memory gecached per source), base `https://api.trustpilot.com/v1/`. Invite: `POST /v1/private/business-units/{id}/email-invitations`. Reviews: `GET /v1/business-units/{id}` (summary) + `GET /v1/business-units/{id}/reviews` (feed). Creds `{apiKey, apiSecret}`, config `{businessUnitId}`.
- **google** — Google Business Profile (My Business v4), Bearer access-token, base `https://mybusiness.googleapis.com/v4/`. **Read-only — geen invitation-API** (`sendInvitation` returnt `not_supported` raw-note, breekt niet). Reviews: `GET /v4/accounts/{accountId}/locations/{locationId}/reviews`. Creds `{accessToken}`, config `{accountId, locationId}`.

## Conventies bevestigd
- **Koppel-klaar**: elke netwerk-call (`sendInvitation`/`fetchReviews`) zit achter `requireCreds()` die een typed `ReviewSourceNotConnectedError` (`error='review_source_not_connected'`) gooit zolang `status !== 'connected'` of creds leeg zijn. `verifyConnection` throwt NOOIT (geeft `{ok:false}`). `requestReviewInvitation` throwt NOOIT naar de caller. Niets vuurt live zonder credentials.
- **Creds encrypted + masked** via `lib/channel-crypto.ts` (`encryptCredentials`/`decryptCredentials`/`maskCredentials`) — hergebruik, geen nieuwe crypto.
- **Mutations** via `runInTransactionWithAudit` met `entityType='review_source'`. `reviews` worden idempotent geüpsert op de UNIQUE (source_id, external_id) buiten audit (bulk fetch). `review_invitations` is append-only (geen audit-rij, het log IS de trail).
- **Idempotente seed** (check-per-provider, mirror `seedChannels`).
- **Geen nieuwe npm-dependencies**; alle adapters gebruiken de globale `fetch`.

## Typecheck
`src/routes/reviews/**` + `src/domain/reviews/**` + `src/db/schema/reviews.ts` + `src/db/seed-reviews.ts` compileren schoon (0 nieuwe TS-errors). Geverifieerd met een tijdelijke `tsconfig` die de pre-bestaande `TS6059 drizzle.config.ts is not under rootDir`-blokkade omzeilt: de enige overgebleven errors zitten in pre-bestaande, niet-aangeraakte modules (`domain/finance/ubl.ts`, `domain/products/slug-unique.ts`, `domain/stock/transaction-helpers.ts`, `routes/webhooks/index.ts`) en staan los van reviews.
