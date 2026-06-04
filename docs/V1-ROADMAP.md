# V1 Roadmap — Webshop-CRM

**Versie**: 0.1 (concept)
**Auteur**: Atlas (agent1)
**Datum**: 2026-05-09

5 fasen, sequentieel maar elke fase landt iets demonstreerbaar. Schattingen zijn voor 1 agent + Atlas-coordinatie. Bij parallel-fanout 2-3x sneller (zoals bij `aicentrum-platform` deed).

---

## Fase 1 — Foundation (data-model + admin-skelet)

**Doel**: Operator kan inloggen, een product aanmaken met varianten + foto's, voorraad mutaties doen, en alles is auditeerbaar in Postgres.

### Scope
- Postgres + Drizzle migrations (alle V1-tabellen, zie `DB-SCHEMA.md`)
- Hono API skelet met auth (Lucia) + 1 admin-user seed
- Admin-frontend (TanStack Router + AI Centrum theme)
- Product-CRUD + Variant-CRUD + Image-upload (lokaal)
- Stock-CRUD per locatie + handmatige adjustments
- Movements-log read-only view
- 1 default-location seed
- Audit-log triggers

### Deliverables
- `apps/api` running op `:7300` met `/health` + `/api/auth/login` + `/api/products/*` + `/api/stock/*`
- `apps/admin` running op `:7301`, login-flow + 4 pages: Producten / Voorraad / Movements / Settings
- 50 demo-products geseed via `scripts/seed.ts`
- README + DEV-SETUP.md (dependencies, db-bootstrap, migrate, seed, dev)

### Acceptance
- [ ] `pnpm dev` start db+api+admin, alle 3 healthy in <30s
- [ ] Admin-login werkt, sessie persistent na page-reload
- [ ] Product met 3 varianten + 2 foto's aanmaken via admin → in Postgres correct opgeslagen
- [ ] Stock-mutation +5 in default-location → movements-log toont entry met user+ts
- [ ] Idempotency-key herhaling geeft cached response
- [ ] Drizzle migrate/rollback werkt 2 niveaus diep

### Suggested owner
**Aether (agent2)** — heeft net storefront-templates gedaan dus product/variant-modellen al in hoofd. Of nieuwe agent **Iris** voor backend-skelet + Aether voor admin-UI.

### Effort
~4-6 uur agent-werk (met fanout: 2-3 uur).

---

## Fase 2 — Storefront-API + 1 webshop live

**Doel**: Aether's `webshop-template` (koffiemachines) hangt aan deze CRM en serveert producten + checkout-flow tot aan order-creatie.

### Scope
- `/storefront/v1/*` REST-endpoints (zie ARCHITECTURE.md)
- Storefront-token-auth + rate-limit
- Cart-flow met server-side voorraad-reservation (15 min expiry)
- Checkout endpoint met BTW-berekening (NL B2C V1, 21% default + 9% subset)
- Order-create endpoint (post-payment, payment-provider mock V1)
- Aether's koffie-template aansluiten op deze CRM (vervangt mock-data)

### Deliverables
- `apps/api/src/routes/storefront/*.ts` — 8 endpoints + OpenAPI-spec auto-generatie
- `packages/shared/src/storefront-api.ts` — typed client voor Next.js storefronts
- `apps/storefront-template` aangepast: vervang hardcoded products door API-calls
- `cleanup-expired-reservations` BullMQ cron werkt

### Acceptance
- [ ] Storefront op `:7302` toont products uit CRM, prijzen kloppen met admin
- [ ] Add-to-cart maakt reservation in DB, blokkeert het aantal voor andere channels
- [ ] Checkout-flow tot en met "betaling-mock-success" creeert echte order met juiste BTW
- [ ] 15min later: niet-betaalde reservation wordt automatisch vrijgegeven
- [ ] Storefront-token uit env werkt; verkeerde token = 401
- [ ] OpenAPI-spec gegenereerd, Aether kan dit gebruiken om typed-client te bouwen

### Suggested owner
**Sage** (storefront-API integration) + **Aether** (Next.js template-aansluiting) parallel.

### Effort
~6-8 uur agent-werk.

---

## Fase 3 — Channels V1 (GMC + Bol)

**Doel**: Eén product in admin → simultaan zichtbaar op Google Shopping (XML feed) én Bol-Offers (live of sandbox). Bol-orders komen automatisch binnen.

### Scope
- Channel-adapter interface in `packages/channel-adapters`
- **GMC-adapter**: XML-feed-builder met alle 8 required velden + `g:item_group_id` + `g:shipping`, daily refresh, geserved op `/feeds/gmc.xml`
- **Bol-adapter**: OAuth2-token-flow, offers-CRUD, orders-poll (5min cron), shipments-push, returns-poll
- Per-product per-channel toggle in admin (`channel_products` join-table)
- Per-channel category-mapping admin-UI
- Prijs-modifier per kanaal (`+10% Bol marge`)
- Channel-credentials encrypted-storage flow

### Deliverables
- `packages/channel-adapters/gmc/` — feed-generator + scheduled job
- `packages/channel-adapters/bol/` — OAuth client + alle order-flow endpoints
- Admin-UI tab `Kanalen` met:
  - Connect-flow (Bol-credentials invoeren, GMC-targetURL)
  - Per-product matrix (welke producten op welke channel actief)
  - Category-mapping editor
  - Live-status indicator (last-poll-at, last-error)
- BullMQ-jobs: `poll-bol-orders`, `build-gmc-feed`, `push-channel-inventory`

### Acceptance
- [ ] Product in admin op "GMC enabled" → na 1u zichtbaar in `/feeds/gmc.xml` met alle 8 fields
- [ ] GMC-diagnostics-tool valideert feed (handmatig getest)
- [ ] Product op "Bol enabled" → offer verschijnt op Bol-sandbox
- [ ] Mock-bestelling in Bol-sandbox → komt binnen 5min binnen in CRM als order-record
- [ ] Voorraadmutatie in admin → na 30s gepushed naar Bol via Offers-API
- [ ] Bol-credentials zijn encrypted in DB (visueel check: niet leesbaar in `psql`)

### Suggested owner
**Forge** (Bol-API, langlopende-poll-flows) + **Echo** (GMC-feed, simpler maar XML-validatie strict).

### Effort
~10-14 uur agent-werk (Bol-API heeft veel edge-cases, sandbox-test-loop).

### Risico
GS1-EAN-membership moet voor go-live geregeld zijn. Tot die tijd: Bol-sandbox + dummy-EAN's voor dev.

---

## Fase 4 — Ledger + BTW + Boekhoud-export

**Doel**: Elke order genereert correcte ledger-entries; daily-aggregatie pusht naar Moneybird (of UBL-bestand voor boekhouder); kwartaal-OSS-export werkt.

### Scope
- `ledger_entries` tabel + automatic-create-triggers bij shipment
- BTW-tarief lookup `(productType, klantLand, klantType) → tarief` met seed-data NL+EU
- VIES-API integratie voor B2B BTW-validatie
- Accounting-adapter interface
- **UBL-adapter**: SI-UBL 2.0 NL-formaat XML-export per dag
- **Moneybird-adapter**: OAuth2-connect + daily-aggregatie-job → external_sales_invoice per kanaal+BTW
- Admin-UI tab `Financieel`:
  - Day/week/month overzicht omzet+marge per shop+kanaal
  - Open BTW per kwartaal (OSS, ICP)
  - Export-knoppen: UBL, OSS-CSV, ICP-CSV, Moneybird-trigger

### Deliverables
- `packages/accounting-adapters/ubl/` — UBL-bestand-generator
- `packages/accounting-adapters/moneybird/` — OAuth + push-flow
- `daily-ledger-aggregate` BullMQ-cron 02:00
- Admin Financieel-page met KPI-cards + per-product/kanaal/shop drill-down
- Seed-data: alle NL+EU BTW-tarieven 2026, OSS-tariefen alle 27 landen

### Acceptance
- [ ] Order met 2 line-items + verzendkosten → 4 ledger_entries (omzet, BTW21, omzet9, BTW9, COGS, verzend) correct gemerkt
- [ ] B2B-order met geldig EU-BTW-nr (VIES-validated) → 0% BTW + ICP-flag
- [ ] B2C-order naar DE >10K-grens → DE-19% BTW (OSS)
- [ ] Daily-aggregate creeert 1 invoice per (kanaal, btw_tarief) in Moneybird sandbox
- [ ] UBL-bestand opent in Moneybird en in 1 externe boekhoud-tool zonder errors
- [ ] OSS-CSV-export Q1-2026-mock matcht Mijn Belastingdienst-format

### Suggested owner
**Apollo** (financieel/precisie) — beste fit voor BTW-edge-cases. Met **Janus** voor UBL/Moneybird-API-werk parallel.

### Effort
~10-12 uur agent-werk. BTW-edge-cases kosten tijd.

---

## Fase 5 — Amazon SP-API + Verzending + Polish

**Doel**: Tweede marketplace (Amazon NL) draait, verzending via Sendcloud automatisch, alle V1-acceptance-criteria green.

### Scope
- **Amazon-adapter**: LWA-flow + Orders-poll (1/min throttle) + Feeds-API push voor inventory/price
- **Sendcloud-adapter**: V3 API parcel-create + label-PDF + tracking-webhook
- Carrier-rules: gewicht+postcode → carrier+service-code (V1: hardcoded NL=PostNL/EU=DHL)
- Tracking-webhook → order.status update + klant-email-mock
- Admin-UI: per-order "Genereer label"-knop met preview + verzend
- E2E-test: handmatig product → order-via-Bol-mock → label-print → tracking-update → ledger-entry → Moneybird-aggregate

### Deliverables
- `packages/channel-adapters/amazon/` — alle SP-API-endpoints
- `packages/carrier-adapters/sendcloud/` — V3 client
- BullMQ: `poll-amazon-orders` + webhook-handler `/webhooks/sendcloud/tracking`
- Admin Order-detail-page met fulfillment-flow
- Playwright E2E-script `tests/e2e/v1-happy-path.spec.ts`

### Acceptance
- [ ] Amazon-mock-order komt binnen, allocatie + label, tracking → DELIVERED in 1 sessie
- [ ] Bulk-product-update (10 prijzen) wordt 1 Feed naar Amazon (geen 10 single-calls)
- [ ] Sendcloud-tracking-webhook arriveert via cloudflared, order-status update werkelijk
- [ ] Alle 6 V1-success-criteria uit VISION.md zijn green
- [ ] Audit-log compleet: order → ship → tracking → ledger → invoice
- [ ] README/DEPLOY.md klaar voor V2-VPS-migration

### Suggested owner
**Forge** (Amazon, lijkt op Bol-werk) + **Aether** (admin-polish + Playwright).

### Effort
~8-10 uur agent-werk.

---

## Totaaltijd-schatting V1

- Fase 1: 4-6u
- Fase 2: 6-8u
- Fase 3: 10-14u
- Fase 4: 10-12u
- Fase 5: 8-10u

**Som**: 38-50 uur agent-werk.
**Real-time** met Atlas-coordinatie + 2-3 parallel agents per fase: ~3-4 dagen doorlooptijd intensief, ~1.5-2 weken normaal tempo.

## Volgorde-beslissingen

- **Fase 3 (channels) komt voor Fase 4 (financieel)** omdat we anders niets hebben om financieel over uit te rekenen.
- **GMC eerst, dan Bol** binnen Fase 3 omdat GMC simpler is (XML-feed, geen OAuth-2-way-token-management).
- **Sendcloud in Fase 5** ipv Fase 3 omdat verzending een handmatige workaround heeft (label kopieren uit Bol-tab) — niet kritiek voor first-cycle.
- **Amazon in Fase 5** omdat approval-process 1-2 weken duurt; parallel aanvragen tijdens Fase 1-3.

## Pre-launch checklist (voor V1-go-live)

| Actie | Wie | Wanneer |
|---|---|---|
| GS1-NL membership inkopen | Operator | vóór Fase 3 live-Bol |
| Amazon Developer-account + SP-API approval | Operator + Atlas | start Fase 1 (1-2wk doorlooptijd) |
| Bol-Retailer-account + API credentials | Operator | start Fase 3 |
| Moneybird-account | Operator | start Fase 4 |
| Sendcloud OF MyParcel account + API key | Operator | start Fase 5 |
| Cloudflared **named** tunnel ipv quick-tunnel | Atlas | Fase 1 |
| GMC-account + verified domain | Operator | start Fase 3 |
| Postgres backup-strategie | Atlas | einde Fase 1 |

## V2-doorkijk (na V1-acceptatie)

Niet in scope nu, maar voor context:
- Listings-API Amazon (volledige catalog-push)
- Repricer
- Customer-portal (track-order, retouren)
- E-mail-flows (welcome, abandoned-cart)
- DDP-shipping
- IOSS-aangifte automation
- Multi-currency
- Mobile pick-app
