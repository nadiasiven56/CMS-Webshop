# REGISTER — outbound webhooks dispatcher + delivery-log (`routes/webhooks/`)

**Atlas — outbound-webhook dispatcher + delivery-log.** De webhook-CRUD bestaat al
(`/api/admin/webhooks`, schema `db/schema/webhooks.ts`, migratie 0002). Wat
ontbrak — en deze module toevoegt — is het feitelijk AFVUREN op domein-events met
HMAC-signing, een delivery-log, en een test-fire + log-API.

Strikt binnen scope (geen bestaande bestanden gewijzigd):

- `apps/api/src/domain/webhooks/{events.ts,sign.ts,dispatch.ts}` (nieuw — dispatcher + signing, importeerbaar door andere domeinen)
- `apps/api/src/routes/webhooks/{index.ts,_schemas.ts,_serialize.ts}` (nieuw — delivery-log + test-fire; GEEN duplicaat van de admin-CRUD)
- `apps/api/src/db/schema/webhook-deliveries.ts` (nieuw)
- `apps/api/src/db/seed-webhooks.ts` (nieuw — idempotente no-op-veilige seed)

`routes/index.ts`, `db/schema/index.ts`, `db/seed.ts`, `lib/env.ts`, de migrations
en de bestaande `webhooks`-schema/-route zijn NIET aangeraakt — de orchestrator
wired ze hieronder.

Blueprint gevolgd: `channels/index.ts` + `discounts/index.ts` (route/error/audit-
patroon, `isUuid`, `invalid_id`/`not_found`/`invalid_request`, `$dynamic()` list +
`{items,total,limit,offset}`), `audit-log.ts`/`notifications.ts` (append-only log +
jsonb + index), `seed-notifications.ts` (idempotente seed + CLI-direct-run guard).

---

## 1. Mount (orchestrator voegt toe aan `src/routes/index.ts`)

Import (bij de andere feature-route-imports):

```ts
import { webhookRoutes } from './webhooks/index.js';
```

Mount (in het registration-slot, naast de andere `apiRoutes.route(...)`):

```ts
apiRoutes.route('/webhooks', webhookRoutes);
```

Auth (`requireAuth`) zit al binnen de router (`webhookRoutes.use('*', requireAuth)`).
Géén conflict met `/api/admin/webhooks` (andere prefix) — dit is `/api/webhooks`.

## 2. Schema-export (orchestrator voegt toe aan `src/db/schema/index.ts`)

Eén regel, logisch onder het bestaande `// ─── Webhooks ───`-blok:

```ts
export * from './webhook-deliveries.js';
```

(De domain-/route-laag importeert rechtstreeks uit
`./schema/webhook-deliveries.js`; deze re-export is voor centrale toegang /
`db:generate`.)

## 3. Seed-hook (OPTIONEEL — orchestrator hangt aan de seed-flow)

Import (bij de andere seed-imports in `src/db/seed.ts`):

```ts
import { seedWebhookDeliveries } from './seed-webhooks.js';
```

Aanroep in `main()` (na `seedChannels()`):

```ts
await seedWebhookDeliveries();
```

Idempotent + no-op-veilig: schrijft NOOIT fake delivery-rijen (`inserted:0`). Voegt
hooguit één UITGESCHAKELDE (`active=false`) voorbeeld-webhook toe als er nog géén
enkele webhook bestaat — bestaan er al, dan gebeurt er niets. Los te draaien:
`pnpm --filter @webshop-crm/api exec tsx src/db/seed-webhooks.ts`.

## 4. Env vars

**Geen.** Module is dependency-free (global `fetch` + `AbortController` +
`node:crypto`). De webhook-`secret` is plain text per bestaand schema en wordt als
HMAC-key gebruikt — NIET encrypted.

---

## 5. Migration (handgeschreven — volg de 0001..000N-conventie)

Nieuw bestand, bv. `apps/api/drizzle/000N_webhook_deliveries.sql` (nummer = volgende
vrije index). Puur additief, `CREATE TABLE IF NOT EXISTS`. **Geen** `updated_at` /
trigger — het is een append-only log. Daarna
`pnpm --filter @webshop-crm/api db:migrate`.

> Let op: `db:generate` werkt niet in deze repo (drizzle-kit kan de ESM `.js`-
> imports niet resolven) — daarom handgeschreven, net als 0001–000N.

```sql
-- ============================================================
-- Migration 000N — webhook_deliveries (outbound-webhook delivery-log)
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
```

---

## 6. Integratie-contract — `dispatchWebhookEvent(...)` (HET haakje voor orders/returns)

**DIT is waar de orchestrator firing op domein-events inwiret.** De dispatcher
leeft bewust onder `domain/` (geen route-dependency) zodat order-/return-/product-
/stock-flows hem direct kunnen aanroepen.

**Import-pad (vanuit `domain/orders/...` of `domain/returns/...`):**

```ts
import { dispatchWebhookEvent } from '../webhooks/dispatch.js';
// (vanuit routes/* zou het pad zijn: '../../domain/webhooks/dispatch.js')
```

**Signature:**

```ts
function dispatchWebhookEvent(
  event: WebhookEvent,                 // uit WEBHOOK_EVENTS (zie onder)
  data: Record<string, unknown>,       // event-specifieke payload-body
  opts?: { shopId?: string | null },   // null/omitted = alleen globale webhooks
): Promise<{ delivered: number; matched: number }>;
// matched   = aantal actieve webhooks dat het event matchte
// delivered = aantal daarvan dat 2xx teruggaf
```

**NEVER-THROW-garantie:** `dispatchWebhookEvent` gooit NOOIT naar de caller. Elke
aflevering zit in try/catch; een falende endpoint (timeout 8s / 5xx / DNS) breekt de
order-flow dus nooit. Er wordt ALTIJD een `webhook_deliveries`-rij geschreven
(succes of fout) en `webhooks.last_fired_at` ge-bumpt. Veilig om buiten je eigen
transactie te roepen (fire-and-forget of awaited — beide prima).

**Event-lijst (`WEBHOOK_EVENTS`, uit `domain/webhooks/events.js`):**

```
order.created   order.paid   order.fulfilled   order.cancelled
return.created  return.received
product.created product.updated
stock.low
```

`WebhookEvent` is het union-type van bovenstaande; `isWebhookEvent(s)` is een
type-guard. De envelope die verstuurd wordt is
`{ event, occurredAt: ISO-string, data }` (stabiel geserialiseerd → deterministische
signature).

**Voorbeeld-wiring (orchestrator, later):**

```ts
// na het aanmaken van een order (binnen of na de checkout-transactie):
await dispatchWebhookEvent('order.created',
  { orderId: order.id, orderNumber: order.orderNumber, total: order.grandTotal, currency: order.currency },
  { shopId: order.shopId });

// na betaling (bv. Mollie-webhook → payments-route):
await dispatchWebhookEvent('order.paid', { orderId, orderNumber, amount }, { shopId });

// na een retour:
await dispatchWebhookEvent('return.received', { returnId, orderNumber }, { shopId });

// stock-agent bij lage voorraad:
await dispatchWebhookEvent('stock.low', { variantId, sku, available, threshold }, { shopId });
```

### Hoe de match werkt t.o.v. de BESTAANDE webhooks-tabel (event + scope)

De bestaande tabel heeft een fijnmazig `event`-veld (bv `order.created`) ÉN een
grove `scope`-enum (`order` | `channel` | `all`, vrij text in DB). De dispatcher
honoreert beide (`webhookMatchesEvent` in `dispatch.ts`):

- **event** matcht als het exact gelijk is aan het afgevuurde event, OF een wildcard
  is: `*` (alles) of `<category>.*` (hele categorie, bv `order.*`).
- **scope** matcht als het `all` / `*` is, gelijk is aan de categorie van het event
  (`order.created` → `order`), of leeg/onbekend is (soepel — handmatige rows falen
  niet stil).
- Beide moeten kloppen (AND), plus de shop-filter: een webhook met `shop_id=null`
  is globaal (vuurt altijd); met een `shop_id` vuurt alleen als die `==opts.shopId`.

Signing: HMAC-SHA256 over de exacte body met de plain-text `secret`, meegestuurd als
header `X-Webshop-Signature: sha256=<hex>` (+ `X-Webshop-Event: <event>`). Helpers in
`domain/webhooks/sign.js`: `signPayload(secret, body)`, `verifySignature(secret, body, sig)`,
en de constanten `SIGNATURE_HEADER` / `EVENT_HEADER`. Webhooks zonder `secret` worden
ongesigneerd verstuurd (geen signature-header).

---

## 7. Endpoints (alle `/api/webhooks/*`, achter `requireAuth`)

| Method | Path | Doel |
|---|---|---|
| GET  | `/api/webhooks/events`           | Geeft `{ events: WEBHOOK_EVENTS }` — voor de admin-UI-dropdown. |
| GET  | `/api/webhooks/deliveries`       | Delivery-log, newest first. Query: `webhook_id` (uuid), `event`, `success` (true/false), `limit` (1..200, def 50), `offset`. Resp `{items,total,limit,offset}` (compacte DTO). |
| GET  | `/api/webhooks/deliveries/:id`   | Eén delivery met volle `payload` + `requestHeaders` + `responseBody`. `404 not_found` / `400 invalid_id`. |
| POST | `/api/webhooks/test-fire`        | Vuur een sample-payload. Body `{webhookId}` (laadt de webhook) OF `{event,url,secret?}` (ad-hoc). Optioneel `event` (override sample-event) + `data` (override sample-body). Hergebruikt exact het dispatch-pad → schrijft een delivery-rij. Resp `{ ok, event, delivery:{...} }`. |

Routevolgorde in de router is bewust: `/events` + `/test-fire` + `/deliveries` staan
vóór `/deliveries/:id`, zodat statische paden niet als `:id` worden opgevangen.

---

## 8. Conventies bevestigd

- **Never-throw**: `dispatchWebhookEvent` + `dispatchToTarget` gooien nooit; een
  falende endpoint breekt nooit het order-/return-proces. Log-insert is óók
  best-effort (eigen try/catch).
- **Append-only log**: `webhook_deliveries` heeft geen `updated_at`/trigger; de
  test-fire-write is een plain insert (het log IS de trail) — `runInTransactionWithAudit`
  is hier niet nodig (geen muteerbare entity).
- **HMAC**: SHA256 over exacte body met plain-text `secret`; nooit de secret in de
  gelogde headers (alleen `sha256=<redacted>`).
- **Dependency-free**: global `fetch` + `AbortController` (8s timeout) + `node:crypto`.
- **Hergebruik**: bestaande `webhooks`-tabel + `db`/`logger`/`requireAuth`/`isUuid`.
- **ESM `.js`-imports** overal.

## 9. Typecheck

`npx tsc -p tsconfig.json --noEmit` op `apps/api`: **0** nieuwe errors voor deze
module (alle webhook-bestanden compileren schoon). De enige resterende error is de
pre-bestaande `TS6059 drizzle.config.ts is not under rootDir` die er al stond vóór
deze module (zelfde noot als in de notifications-REGISTER).
