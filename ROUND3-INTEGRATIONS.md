# Webshop-CRM — Ronde 3: Integraties & Platform-features

**Datum:** 2026-06-03 · **Door:** Atlas (agent1) · **Status:** compleet, koppel-klaar, volledig groen geverifieerd.

Deze ronde tilt het multi-channel command center van "compleet systeem" naar "professioneel platform": verzending, e-mail, boekhoud-sync, marketing, reviews, kortingen, analytics, webhooks/audit en een auto-sync-scheduler. Alles is **koppel-klaar** gebouwd zoals Bol/Amazon: volledige officiële scaffolding, elke externe call afgeschermd met een `requireCreds()`-guard die een getypte `*_not_connected`-fout gooit tot er sleutels zijn ingevuld. **Geen enkele live koppeling nodig nu** — sleutels later invullen via de UI, geen code-wijziging meer.

---

## Wat is toegevoegd

### 1. Verzending / carriers — `/shipping` ("Verzending")
- Beheer carriers, genereer verzendlabels, track&trace.
- Adapters (officieel): **Sendcloud** (`{publicKey, secretKey}`), **MyParcel** (`{apiKey}`), **PostNL** (`{apiKey, customerCode, customerNumber}`). DHL geseed als placeholder.
- Backend: `/api/shipping/carriers` (CRUD + credentials + test-connection), `/api/shipping/shipments` (label aanmaken + tracking).
- Bij fulfillment kan een shipment-label worden aangemaakt; tracking-URL gaat mee in de verzendmail.

### 2. E-mail / notificaties — `/notifications` ("E-mail")
- Transactionele mail via pluggable provider: **Postmark** (`{serverToken}`), **SendGrid** (`{apiKey}`), **Mailgun** (`{apiKey}`+domein), **SMTP** (scaffold).
- Templates (NL, bewerkbaar): `order_confirmation`, `order_shipped`, `order_refunded`, `return_received`, `welcome` — met `{{variabelen}}`.
- E-mail-log + test-mail. **Service `sendNotification()` vuurt automatisch** op order-events (zie integraties). Nooit-breekt-contract: zonder actieve provider logt het `skipped_no_provider` i.p.v. te falen.

### 3. Boekhoud-koppeling — `/accounting/koppelingen` ("Boekhoud-koppeling")
- Live sync naast de bestaande UBL-export. Adapters: **Moneybird** (`{accessToken}`+administratie), **Exact Online** (OAuth2), **e-Boekhouden** (`{username, securityCode1/2}`).
- `/api/accounting/connections` (CRUD + credentials + test + **sync** + sync-log). Sync is idempotent (slaat al-gesyncte entiteiten over).
- De originele `/accounting`-pagina (facturen/OSS/UBL) is **ongewijzigd** behouden.

### 4. Marketing-feeds + tracking — `/marketing` ("Marketing")
- **Product-feeds** uit gepubliceerde producten: Google Shopping XML + Meta/Facebook CSV, op **publieke URLs** om in Google Merchant Center / Meta Catalog te plakken:
  - `/api/feeds/public/<shopId>/google.xml`
  - `/api/feeds/public/<shopId>/meta.csv`
  - `/api/feeds/public/<shopId>/analytics.json`
- **Tracking-config** per shop: GA4 measurement-id, Meta Pixel-id, Google Ads-id + conversielabel, custom head-HTML (voor de storefront).

### 5. Reviews — `/reviews` ("Reviews")
- Adapters: **Kiyoh** (`{apiHash}`+locationId), **Trustpilot** (`{apiKey, apiSecret}`+businessUnit), **Google** (read-only).
- `/api/reviews/sources` (CRUD + credentials + test + **fetch**), rating-samenvatting (gemiddelde + verdeling), recente reviews. **Review-uitnodiging** vuurt automatisch bij fulfillment (`requestReviewInvitation()`).

### 6. Kortingen / vouchers — `/discounts` ("Kortingen")
- Kortingscodes: `percentage` / `fixed` / `free_shipping`, met voorwaarden (min. bedrag, geldigheidsvenster, max. gebruik, max. per klant, shop-scope).
- **Werkt live in de storefront-checkout**: code in checkout → `validateDiscountCode()` → korting toegepast op `discount_total` + `grand_total` verlaagd → `recordDiscountRedemption()` idempotent in dezelfde order-transactie. Ongeldige code → 400, geen order. Geen code → ongewijzigd.
- Geseed: `WELKOM10` (10%), `GRATISVERZENDING` (gratis verzending).

### 7. Interne analytics — `/analytics` ("Statistieken")
- Read-only BI over echte data: omzet-over-tijd, top-producten, KPI's (omzet/orders/AOV/units/refunds/nieuwe klanten), kanaal- & shop-breakdown, lage-voorraad + bestel-suggestie, top-klanten. Filters op shop/kanaal/datum/interval. Hergebruikt de hand-rolled SVG-charts van het dashboard (geen nieuwe dependency).

### 8. Uitgaande webhooks + audit-log — `/webhooks` ("Webhook-log") + `/audit-log` ("Audit-log")
- **Dispatcher** `dispatchWebhookEvent()` vuurt op events (`order.created/paid/fulfilled/cancelled`, `return.received`, …), HMAC-getekend (`X-Webshop-Signature`), met delivery-log + retry-veilig. Nooit-breekt-contract.
- Webhook-monitor (deliveries + test-fire) en een **audit-log-scherm** (`/api/audit`) met before/after + IP, los van de bestaande webhook-CRUD in Settings.

### 9. Auto-sync scheduler
- `domain/scheduler/` draait elke 15 min (`SCHEDULER_INTERVAL_MS`, gated via `SCHEDULER_ENABLED`) de gedeelde `runChannelSync()` voor alle **connected** kanalen + ververst review-bronnen. Veilig: try/catch per run, `unref()`, overlap-guard, no-op als niets gekoppeld is. Gestart na server-listen, gestopt bij shutdown.

---

## Hoe later koppelen (officiële weg, geen code)
1. Open de betreffende pagina (bv. Verzending / Boekhoud-koppeling / E-mail / Reviews).
2. "Configureren" → vul de officiële sleutels/tokens in (encrypted opgeslagen, nooit teruggetoond — alleen "Gezet").
3. "Test verbinding" → status wordt `connected`.
4. Klaar: vanaf dat moment vuren mails/webhooks/sync echt; daarvoor loggen ze veilig als `skipped_*`.

Marketing-feeds werken direct (geen account nodig) — plak de publieke feed-URL in GMC/Meta. Tracking-id's invullen op `/marketing`.

---

## Architectuur (consistent met bestaande code)
- Elke module volgt het **channels-patroon**: eigen `routes/<module>/` (index + `_schemas` + `_serialize` + `adapters/`), drizzle-schema, idempotente seed, getypte never-throw `verifyConnection`, `requireCreds`-guards, credentials via `lib/channel-crypto` (AES-256-GCM, masked in responses), mutaties via `runInTransactionWithAudit`. Geld = `numeric(12,4)` in DB, **string** in de API. ESM `.js`-imports.
- Inhaak-services staan onder `domain/` (geen route-afhankelijkheid) zodat orders/returns/checkout/scheduler ze kunnen aanroepen: `sendNotification`, `dispatchWebhookEvent`, `requestReviewInvitation`, `validateDiscountCode`/`recordDiscountRedemption`.
- DB: migraties `0005`–`0011` (15 nieuwe tabellen). Admin: layout + index-route per feature (vermijdt de TanStack-Outlet-bug), Sidebar uitgebreid met secties Marketing / Analytics / Communicatie / Systeem.

## Verificatie (totale check — alles groen)
| Check | Resultaat |
|---|---|
| `api typecheck` | **0 fouten** |
| `admin typecheck` | **0 fouten** |
| `api test` (vitest) | **293/293 geslaagd (28/28 files)** |
| `scripts/smoke-api.mjs` | **SMOKE_PASS** (checkout→order→ledger gebalanceerd→dashboard) |
| e2e `command-center.spec.ts` | **PASS** |
| Playwright Ronde-3 sweep | **10/10 nieuwe pagina's renderen, 0 errors, geen list-bug** |
| Regressie-sweep | **16/16 PASS** (product-edit, checkout ±korting, channels-sync, alle 8 endpoints 200) |

Bonus: één echte latente bug gevonden + gefixt — `sanitizeFilenameStem` collapste path-traversal-namen naar leeg (`'../../etc/passwd'` → nu veilig `'etc-passwd'`).

## Stack draaien
`node scripts/dev-db.mjs` (:7432) · `pnpm --filter @webshop-crm/api dev` (:7300) · `pnpm --filter @webshop-crm/admin dev` (:7301, `VITE_DEMO_MODE=false`). Login `admin@webshop-crm.local` / `admin12345`. Verse DB: `pnpm db:migrate` + `pnpm db:seed`. Optionele env: `PUBLIC_BASE_URL`, `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_MS` (alle optioneel).
