# Webshop-CRM — Multi-channel Command Center (DONE)

**Status:** compleet + end-to-end geverifieerd op 2026-06-02 (ultracode-build, 6 workflow-waves).
**Plan:** `~/.claude/plans/pure-cooking-cerf.md`.

Eén command center voor alle winkels + verkoopkanalen: centraal producten beheren + publiceren, alle orders in één inbox + fulfillen, en één geconsolideerde boekhouding. Bol/Amazon/externe-webshop/betalingen zijn **koppel-klaar** (insteek-punten) — niets externs is live, maar inpluggen is een config-actie, geen code-wijziging. Het eigen-webshop-kanaal werkt al écht.

## Hoe draaien (3 processen, geen Docker)
```
# 1) embedded Postgres (:7432, persistent .pgdata) — keep-alive, run in achtergrond
node scripts/dev-db.mjs
# 2) API (:7300)
pnpm --filter @webshop-crm/api dev
# 3) Admin (:7301)  (al op VITE_DEMO_MODE=false → echte api)
pnpm --filter @webshop-crm/admin dev
```
Login: `admin@webshop-crm.local` / `admin12345`. Flow: login → **/launch** (kies winkel) → admin-shell.
Verse DB opzetten: `pnpm db:migrate` + `pnpm --filter @webshop-crm/api seed` (seedt admin + locatie + vat-rates + **3 channels**).

## Wat er gebouwd is (per wave)
- **A — fundament:** `lib/channel-crypto.ts` (AES-256-GCM creds-encryptie via `CHANNEL_SECRET_KEY`), `domain/finance/ledger-posting.ts` (gebalanceerde dubbele boekhouding, idempotent), `db/seed-channels.ts`, `db/schema/webhooks.ts` + migratie `0002_webhooks.sql`. 13 unit-tests groen.
- **B — backend feature-compleet:**
  - `/api/channels` + adapters: **OwnWebshopAdapter = echt** (sync importeert web-orders + publiceert producten), **Bol/AmazonAdapter = koppel-klaar** (volledige auth/endpoint-scaffolding, geblokkeerd met `credentials required` tot creds er zijn). GMC minimaal koppel-klaar.
  - Boekhouding-automatisering: `postOrderRevenue` bij betaling (orders + storefront-checkout), `postRefund` + auto-restock (voorraad terug + `inventory_movements`) bij refund.
  - `/api/dashboard/kpis` (cross-shop/kanaal, filterbaar), `/api/locations` CRUD, `/api/admin/{users,api-tokens,webhooks}`.
  - Storefront: channel-tagging + ledger-on-checkout + `GET /api/storefront/v1/health`.
- **C — admin mock→echt:** alle 7 mock-pagina's op de echte api (channels-UI + per-product matrix, dashboard + shop/kanaal-filter, locations, returns/RMA, settings users/tokens/webhooks). Edit-drawers overal. (+ routing-fix: index-route-patroon zodat `/channels/matrix` en `/settings/*` echt renderen.)
- **D — consolidatie:** orders "Alle shops + alle kanalen"-inbox (kanaal-chips + shop/kanaal-kolom); geconsolideerde boekhouding met per-kanaal-breakdown + Totaal (P&L afgeleid uit `ledger/aggregate?source=orders` zodat shop/kanaal-filter klopt).
- **E — koppel-klaar + e2e:** drop-in storefront-SDK (`apps/storefront/sdk/webshop-crm-sdk.js` + `example.html` + README) voor statische shops; "Koppel je webshop"-paneel op de shop-detailpagina (slug, API-base, copy-paste snippet, allowed-origins, "Test verbinding", checklist).

## End-to-end bewijs
**API smoke (`node scripts/smoke-api.mjs`) → `SMOKE_PASS`:** own_webshop connect ok · bol "credentials required" · storefront-checkout via SDK → betaalde order (CR-1017) · order in `/api/orders?channel=web` · ledger gebalanceerd (debit==credit) · dashboard-KPIs stijgen.
**Playwright (`apps/admin/e2e/command-center.spec.ts`) → 1 passed, 6/6:** dashboard niet-nul · own_webshop "Verbonden" · bol credentials-state · orders-inbox toont e2e-orders · finance per-kanaal-tabel niet-nul · nul console/page-errors.
Extra QA-scripts: `apps/admin/scripts/verify-{launch,real,waveC,waveD}.mjs`.

## Externe koppelingen later activeren (insteek-punten)
- **Eigen externe webshop (andere pc):** open de shop-detailpagina → "Koppel je webshop", kopieer het SDK-snippet in de statische shop, vul `apiBase` = `https://<crm-host>/api/storefront/v1` + de shop-slug in, zet de origin bij allowed-origins. Klaar — de SDK doet products/cart/checkout tegen deze CRM.
- **Bol.com / Amazon:** Kanalen → Configureren → vul de API-sleutels in (Bol: clientId/clientSecret; Amazon: refreshToken/clientId/clientSecret/marketplaceId) → "Test verbinding" → status wordt `connected` → "Sync nu". Geen code nodig.
- **Betalingen:** checkout is nu test-betaald (mock provider); de aansluiting is voorbereid — een Mollie/Stripe-adapter inpluggen op hetzelfde patroon als de channel-adapters.

## Bekende caveats (eerlijk)
- **~157 pre-existerende TypeScript-fouten** elders in de repo (o.a. `ImageUploader`, `VariantForm`, `products.new`, `ubl.ts`, test-files) — al aanwezig vóór deze build; de api draait via `tsx` (strip types). Geen van de nieuwe code voegt fouten toe. Een aparte opruim-pass kan dit later schoonvegen.
- **`/api/finance/pnl` negeert de `channel`-param** — daarom leidt het finance-scherm de per-kanaal/gefilterde cijfers af uit `ledger/aggregate` (klopt wel). Backend-pnl kan later channel-aware gemaakt worden.
- **`example.html`** moet via http(s) geserveerd worden (ES-module-import werkt niet vanaf `file://`).
- **Bol-kanaal toont credentials "Gezet"** terwijl het een lege `{}` is (cosmetisch); de status "Fout"/"credentials required" is het juiste signaal.
- Geen demo bol/amazon-orders → die kanaal-filters tonen leeg tot er echte marketplace-orders binnenkomen (correct gedrag).

## Belangrijkste nieuwe bestanden
Backend: `apps/api/src/lib/channel-crypto.ts`, `apps/api/src/domain/finance/ledger-posting.ts`, `apps/api/src/db/seed-channels.ts`, `apps/api/src/db/schema/webhooks.ts` (+`drizzle/0002_webhooks.sql`), `apps/api/src/routes/{channels,dashboard,locations,admin}/**`.
Admin: `apps/admin/src/components/{channels,dashboard,locations,returns,settings}/api.ts` + `components/shops/ConnectPanel.tsx` + `components/settings/SettingsTabs.tsx`; route-files in `routes/_app/` omgezet naar echte api + index-route-patroon (`channels.index.tsx`, `settings.index.tsx`).
Connect-ready: `apps/storefront/sdk/{webshop-crm-sdk.js,example.html,README.md}`; `scripts/smoke-api.mjs` (uitgebreid); `apps/admin/e2e/command-center.spec.ts`.

---

## Officieel koppel-klaar (2026-06-02, ronde 2)

De adapters volgen nu de **officiële API-contracten** — je hoeft later alleen je sleutels te plakken. Volledige stap-voor-stap onboarding: **`docs/CONNECT-OFFICIAL.md`**.

- **Bol.com Retailer API v10** (`adapters/bol.ts` + `_bol-client.ts`): OAuth2 client-credentials (`login.bol.com/token`, Basic auth), `vnd.retailer.v10+json`, **demo-env default** (`api.bol.com/retailer-demo`) → `production`, async process-status polling, 429-backoff. Velden: `clientId`, `clientSecret`, `config.environment`. 18 tests groen.
- **Amazon SP-API** (`adapters/amazon.ts` + `_spapi-client.ts`): LWA-only (geen SigV4), `api.amazon.com/auth/o2/token`, `x-amz-access-token`-header, regio-host (NL=`A1805IZSGTT6HS`, EU), sandbox-toggle, RDT voor buyer-PII, NextToken-paginatie. Velden: LWA `clientId`/`clientSecret` (gelabeld "LWA …"), `refreshToken`, `sellerId`, `config.{marketplaceIds,region,environment}`. 22 tests groen.
- **Storefront publishable token** (officiële headless-koppeling, Shopify/Medusa-stijl): per-shop `wcrm_pk_…` token (sha256-hash opgeslagen, 1× getoond), header `X-Storefront-Token`; slug blijft fallback. Genereren in admin → Shops → <shop> → "Koppel je webshop". SDK v1.1.0 stuurt de header. Live geverifieerd: resolve via token zónder slug → 200.
- **Mollie-betalingen** (`domain/payments/` + `routes/payments/mollie-webhook`): API-key (`test_`/`live_`), `POST /v2/payments` → redirect → webhook → `GET /v2/payments/{id}`, idempotent. Per shop instelbaar (admin → Shops → <shop> → Betalingen), key **encrypted** opgeslagen, `hasPaymentKey` zonder lek. **Zonder key blijft checkout test-betaald** (niets breekt). 19 tests groen.

Guards: elke marketplace/PSP-call vuurt alleen bij ingevulde creds + `status=connected` → anders typed `credentials required`. Alles getest tegen compile + unit-tests; live-test tegen de vendor volgt zodra jij sleutels invult.

**Extra gefixt deze ronde:** shops-routing (index-route-patroon — `/shops/:id` toonde de lijst; nu de detail mét connect/betaal-paneel), de bol-"Gezet"-display (alleen bij echte creds), en de publicatie-matrix (products-limit 200→100). Eindverificatie: alle admin-pagina's + shop-detail + config-drawer **nul console/page/api-errors**, admin-typecheck = alleen de 4 bekende pre-existerende fouten.

**Nog open (niet-blokkerend):** 4 pre-existerende type-fouten in de product-creatie-flow (ImageUploader/VariantForm/products.new) — runtime werkt, los van de koppelingen; los te trekken in een aparte opruim-pass.
