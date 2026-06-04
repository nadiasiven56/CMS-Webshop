# REGISTER — notifications / email (`routes/notifications/`)

**Atlas — transactionele-email module (koppel-klaar).** Strikt binnen:
- `apps/api/src/routes/notifications/**` (nieuw)
- `apps/api/src/domain/notifications/**` (nieuw — send-service + provider-adapters)
- `apps/api/src/db/schema/notifications.ts` (nieuw)
- `apps/api/src/db/seed-notifications.ts` (nieuw)

Geen andere folders aangeraakt. `routes/index.ts`, `db/schema/index.ts`, `db/seed.ts`, `lib/env.ts` en de migrations worden door de **orchestrator/finalizer** gewired — instructies hieronder.

De channels- + accounting-modules zijn exact als blueprint gevolgd (provider-registry + requireCreds-guard + encrypted/masked creds via `lib/channel-crypto.ts` + `runInTransactionWithAudit` + idempotente seed + never-throw verify).

---

## 1. Mount (orchestrator voegt toe aan `routes/index.ts`)

```ts
// import (bij de andere feature-routers)
import { notificationRoutes } from './notifications/index.js';

// op het feature-agent registration slot
apiRoutes.route('/notifications', notificationRoutes);
```

Alle endpoints zitten al achter `requireAuth` (`notificationRoutes.use('*', requireAuth)` staat in de router zelf) — geen extra middleware nodig.

## 2. Schema-export (orchestrator voegt toe aan `db/schema/index.ts`)

```ts
// ─── Notifications / e-mail ──────────────────────────────────
export * from './notifications.js';
```

(Plaats logisch onder het bestaande `// ─── Webhooks ───`-blok.)

## 3. Seed-hook (orchestrator hangt aan de seed-flow)

Nieuw bestand `apps/api/src/db/seed-notifications.ts` exporteert `seedNotifications()` (idempotent — templates via `onConflictDoNothing` op de UNIQUE `key`; provider-placeholder via check-per-provider, mirror `seedChannels()`/`seedAccounting()`).

In `apps/api/src/db/seed.ts`:

```ts
import { seedNotifications } from './seed-notifications.js';
// ... binnen main(), na seedChannels()/seedAccounting():
await seedNotifications();
```

Of los draaien:
`pnpm --filter @webshop-crm/api exec tsx src/db/seed-notifications.ts`
(het bestand heeft een eigen CLI-entry die alleen draait bij directe uitvoer.)

Seedt 5 Nederlandse default-templates (`order_confirmation`, `order_shipped`, `order_refunded`, `return_received`, `welcome`) met `{{customerName}}` / `{{orderNumber}}` / `{{total}}` / `{{trackingUrl}}` placeholders, plus 1 `smtp` provider-row als `disconnected` + `is_active=false`. Geen credentials.

## 4. Env vars (allemaal OPTIONEEL — geen wijziging aan `lib/env.ts` nodig)

Deze module hergebruikt `CHANNEL_SECRET_KEY` (bestaat al in `lib/env.ts`) voor credential-encryptie via `lib/channel-crypto.ts`. Er zijn **geen nieuwe verplichte env vars**.

Per-provider API-keys/tokens worden NIET uit env gelezen maar per provider via `PUT /providers/:id/credentials` ingevoerd en encrypted opgeslagen. Wil de orchestrator later defaults via env aanbieden, dan zijn dit logische (optionele) namen — nu niet vereist:

```
# OPTIONEEL — niet gelezen door deze module; alleen als de orchestrator later
# provider-keys centraal wil bewaren i.p.v. per-provider invoeren.
POSTMARK_SERVER_TOKEN=
SENDGRID_API_KEY=
MAILGUN_API_KEY=
MAILGUN_DOMAIN=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=
EMAIL_FROM_NAME=
```

## 5. Migration (handgeschreven — volg de 0001..0004-conventie)

Nieuw bestand: `apps/api/drizzle/0005_notifications.sql`. Puur additief, `CREATE TABLE IF NOT EXISTS`, hergebruikt de bestaande `set_updated_at()`-functie (uit 0000). Daarna `pnpm --filter @webshop-crm/api db:migrate`.

> Let op: `db:generate` werkt niet in deze repo (drizzle-kit 0.28.1 kan de ESM `.js`-imports niet resolven) — daarom de handgeschreven migratie, net als bij 0001–0004.

```sql
-- ============================================================
-- Migration 0005 — transactionele e-mail (notifications)
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
```

---

## 6. Publieke service voor orders/returns — `sendNotification(...)`

**DIT is het integratie-contract.** De orchestrator wire de echte triggers in de orders-/returns-modules door deze service aan te roepen. De service leeft bewust onder `domain/` (geen route-dependency).

**Import-pad (vanuit `domain/orders/...` of `domain/returns/...`):**

```ts
import { sendNotification } from '../notifications/send.js';
// (vanuit routes/* zou het pad zijn: '../../domain/notifications/send.js')
```

**Signature:**

```ts
function sendNotification(opts: {
  templateKey: string;                 // 'order_confirmation' | 'order_shipped' | ...
  to: string;                          // recipient email
  data: Record<string, unknown>;       // {{var}}-substituties
  orderId?: string;                    // optioneel — correleert de log-rij
}): Promise<{ status: string; logId: string }>;
// status ∈ 'sent' | 'failed' | 'skipped_no_provider'
```

**Voorbeeld-wiring (orchestrator, later):**

```ts
// na het aanmaken van een order:
await sendNotification({
  templateKey: 'order_confirmation',
  to: order.email,
  data: { customerName, orderNumber: order.orderNumber, total },
  orderId: order.id,
});

// na verzending:
await sendNotification({
  templateKey: 'order_shipped',
  to: order.email,
  data: { customerName, orderNumber: order.orderNumber, trackingUrl },
  orderId: order.id,
});

// na een retour:
await sendNotification({
  templateKey: 'return_received',
  to: customer.email,
  data: { customerName, orderNumber },
  orderId,
});
```

**KOPPEL-KLAAR / NEVER-THROW-garantie:** `sendNotification` gooit NOOIT naar de caller. Als er geen actieve, `connected` provider is → schrijft een `email_log`-rij met status `skipped_no_provider` en returnt (orders/returns breken dus nooit op ontbrekende email-config). Bij een provider-fout → `failed` met `error`. Er wordt ALTIJD precies één log-rij geschreven.

Ook geëxporteerd vanuit `domain/notifications/send.js`: `renderTemplate(str, data)` — de pure `{{var}}`-replacer (geen dependency).

---

## Endpoints (allemaal `/api/notifications/*`, achter `requireAuth`)

| Method | Path | Beschrijving |
|---|---|---|
| GET    | `/providers`                          | List providers (filter `?provider=&status=`, paginated). Masked creds + `isActive`. |
| POST   | `/providers`                          | Create. Body `{provider, name, config?}`. Start `disconnected` + inactive. |
| GET    | `/providers/:id`                      | Detail (masked creds). |
| PATCH  | `/providers/:id`                      | Partial update `{name?, config?, status?}`. |
| DELETE | `/providers/:id`                      | Delete. |
| PUT    | `/providers/:id/credentials`          | Encrypt + store creds (per-provider zod-schema). 422 bij onbekende provider. |
| POST   | `/providers/:id/test-connection`      | Decrypt in-memory → `verifyConnection` (never-throws) → persist status (`connected`/`error`) + `lastTestAt`. |
| POST   | `/providers/:id/activate`             | Single-active-provider: zet `is_active=true`, alle andere `false`. |
| GET    | `/templates`                          | List templates. |
| GET    | `/templates/:key`                     | Template detail. |
| PATCH  | `/templates/:key`                     | Edit `{name?, subject?, bodyHtml?, bodyText?, enabled?, locale?}`. |
| POST   | `/test-send`                          | Body `{to, templateKey}`. Roept `sendNotification` met sample-data. Geen provider → `skipped_no_provider` + duidelijke message (nooit 500). |
| GET    | `/log`                                | Delivery-log paginated (`?to=&order_id=&limit=&offset=`). |

### Providers + credential-shapes (encrypted opgeslagen, nooit raw terug)
- **postmark** — header `X-Postmark-Server-Token`, POST `https://api.postmarkapp.com/email`. Creds `{serverToken}`.
- **sendgrid** — Bearer apiKey, POST `https://api.sendgrid.com/v3/mail/send` (202 + `X-Message-Id` header). Creds `{apiKey}`.
- **mailgun** — Basic auth `api:{key}`, POST `https://api.mailgun.net/v3/{domain}/messages` (form). Creds `{apiKey}`, config `{mailgunDomain}`.
- **smtp** — Creds `{host, port, user, pass, secure}`. **Dependency-free scaffold**: `verifyConnection` controleert alleen of host+user+pass aanwezig zijn (geen socket → detail `'config present'`); `send` gooit `EmailProviderNotConnectedError('smtp transport not yet enabled')`. TODO voor de orchestrator: nodemailer wiren of SMTP via een HTTP-provider routeren. Geen nieuwe npm-dependency toegevoegd.

## Conventies bevestigd
- **Koppel-klaar**: elke netwerk-`send` zit achter `requireCreds()` die een typed `EmailProviderNotConnectedError` (`error='email_provider_not_connected'`) gooit zolang `status !== 'connected'` of creds leeg zijn. `verifyConnection` throwt NOOIT (geeft `{ok:false}`). `sendNotification` throwt NOOIT naar de caller. Niets vuurt live zonder credentials.
- **Creds encrypted + masked** via `lib/channel-crypto.ts` (`encryptCredentials`/`decryptCredentials`/`maskCredentials`) — hergebruik, geen nieuwe crypto.
- **Mutations** via `runInTransactionWithAudit` met `entityType='email_provider'` of `'email_template'`. `email_log` is append-only (geen audit-rij, het log IS de trail).
- **Idempotente seed** (templates via UNIQUE-key onConflictDoNothing; provider check-per-provider).
- **Geen nieuwe npm-dependencies**; pure `renderTemplate` `{{var}}`-replacer.

## Typecheck
`src/routes/notifications/**` + `src/domain/notifications/**` + `src/db/schema/notifications.ts` + `src/db/seed-notifications.ts` compileren schoon (geen nieuwe TS-errors). De enige openstaande error bij `tsc -p tsconfig.build.json` is de pre-bestaande `TS6059 drizzle.config.ts is not under rootDir` — die stond er al vóór deze module en staat los van notifications.
```
