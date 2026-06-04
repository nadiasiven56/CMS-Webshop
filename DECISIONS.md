# Decisions log

Lopend overzicht van alle scope/architectuur-beslissingen — wie, wanneer, waarom.

## 2026-05-09 — Initiele scope-bepaling

### Operator-antwoorden (1e ronde)

| # | Vraag | Antwoord | Implicatie |
|---|---|---|---|
| 1 | Bestaande webshops? | Allemaal custom (greenfield) | Geen import/migratie-tooling, schoon schema mogelijk |
| 2 | Marketplace-prio? | Geen, maar moet allemaal kunnen (Bol/Amazon/GMC) | Adapter/plugin-architectuur per channel verplicht in V1 |
| 3 | Boekhouding? | Eigen lichte engine + export naar boekhouder | Interne ledger, UBL-export als standaard, optionele Moneybird/Exact-koppeling later |
| 4 | Magazijn? | 1 nu, multi-warehouse later | `location_id` overal in stock-schema, V1 default-location |
| 5 | Schaal? | "Geen idee, zelf doen" | MKB-default: 1k-50k SKU, ~100 orders/dag start, hoofdletter-OK tot 1000/dag |

### Atlas autonome keuzes (operator-mandaat: "zelf doen")

- **Tech-stack backend**: Postgres + Node/TypeScript + Hono (lichter dan Fastify, betere ergonomics dan Express)
- **Tech-stack admin-frontend**: React + TanStack Router + Vite + AI Centrum theme (consistent met Hermes-workspace)
- **Tech-stack storefronts**: Next.js per shop (SSR/SEO-vriendelijk, headless via CRM-API)
- **Hosting V1**: lokaal op `hoi`, Postgres lokaal (Windows-service of Docker Desktop), tunnel via cloudflared zoals bestaand pattern
- **Auth V1**: simpele sessie-cookies met admin-login (geen multi-tenant nodig — operator is enige user). API-tokens voor storefronts/channels.
- **Geld-precisie**: alle bedragen als `numeric(12,4)` cents-equivalent, NOOIT floats. BTW altijd apart opgeslagen.

### Architectuur-principes (vastgelegd, niet onderhandelbaar)

1. **Plugin-architectuur voor channels** — `channels/<slug>/` met adapter-interface. Storefronts, Bol, Amazon, GMC zijn alle implementaties.
2. **Plugin-architectuur voor carriers** — `carriers/<slug>/` (PostNL/DHL/DPD/Sendcloud).
3. **Plugin-architectuur voor accounting-export** — `accounting/<slug>/` (UBL, Moneybird, Exact, CSV).
4. **Multi-warehouse-ready schema** — `stock_levels(product_id, location_id, qty, reserved)` van dag 1.
5. **Eén canonical product-model** — channels mappen ALTIJD vanuit die canonical, nooit andersom.
6. **Audit-trail standaard** — elke order/stock/inkoop-mutatie heeft een append-only log-entry.

### Niet-doelen V1 (expliciet uitgesloten)

- Geen multi-tenant (geen klanten-van-klanten)
- Geen B2B-portal/wholesale (V2)
- Geen aparte POS-flow (V2 als nodig)
- Geen mobile-app (admin is responsive web V1)
- Geen AI-features in CRM zelf (admin gebruikt AI Centrum's chat als external tool)

## 2026-05-09 — Aether parallel-context

Aether (agent2) bouwt parallel `webshop-template` (koffiemachines + hondenvoer) met "CRM-hook configurable". Atlas's verantwoordelijkheid: API-contract publiceren in ARCHITECTURE.md zodat Aether's templates compatibel blijven. Geen overlap — Aether = storefront, Atlas = master.
