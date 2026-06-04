# Architecture — Webshop-CRM

**Versie**: 0.1 (concept)
**Auteur**: Atlas (agent1)
**Datum**: 2026-05-09

## Overzicht

```
                 ┌─────────────────────────────────────────────────┐
                 │                  WEBSHOP-CRM (master)           │
                 │  Postgres ▸ Hono API ▸ Admin (TanStack)         │
                 │  Adapters: channels/* carriers/* accounting/*   │
                 └────┬────────────┬────────────┬────────────┬─────┘
                      │            │            │            │
              ┌───────▼───┐  ┌─────▼────┐  ┌────▼────┐ ┌─────▼─────┐
              │ Storefront│  │   Bol    │  │ Amazon  │ │   GMC     │
              │  Next.js  │  │ Retailer │  │ SP-API  │ │  XML feed │
              │  (Aether) │  │   API    │  │         │ │   (S3)    │
              └───────────┘  └──────────┘  └─────────┘ └───────────┘
```

Eén centraal systeem (CRM-master) waar alle kanalen — eigen storefronts én marketplaces — adapters van zijn. Alle voorraad, klanten, orders en financien komen samen in Postgres.

## Tech-stack

| Laag | Keuze | Waarom |
|---|---|---|
| **Database** | Postgres 16 | ACID voor financieel/voorraad, mature, lokaal makkelijk te draaien |
| **ORM** | Drizzle | SQL-first, type-safe, lichter dan Prisma, betere ergonomics voor analytische queries (winst/voorraad) |
| **Backend runtime** | Node 22 + TypeScript (strict) | Consistent met Hermes-stack, hot-reload via tsx |
| **HTTP framework** | Hono | Lichter dan Express, ingebouwde OpenAPI, edge-ready (later) |
| **Auth** | Lucia (sessie-cookies admin) + JWT (storefront/channel API-tokens) | Simple, geen vendor-lock |
| **Background jobs** | BullMQ + Redis | Industry-default voor poll-loops + cron, retry-policies, dashboard |
| **Storage (V1)** | Lokaal filesystem (`storage/`) achter API-route | Geen vendor-keuze nodig V1; S3-adapter later |
| **Admin UI** | React 19 + TanStack Router + Vite | Consistent met Hermes-workspace, AI Centrum-thema reusable |
| **Storefronts** | Next.js 15 (App Router) per shop | SSR/SEO-vriendelijk, headless via CRM-API |
| **Tunnel** | cloudflared (zelfde pattern als Hermes) | Externe webhooks (Bol/Sendcloud) bereiken lokale dev |
| **Observability** | Pino (structured logs) + simpel /metrics endpoint | Geen Datadog vendor V1 |

## Repo-layout (monorepo)

```
webshop-crm/
├── apps/
│   ├── api/                  # Hono backend
│   │   ├── src/
│   │   │   ├── routes/       # /products, /orders, /channels, /storefront/*
│   │   │   ├── domain/       # business-logic (allocate, fulfill, ledger)
│   │   │   ├── jobs/         # BullMQ workers (poll-bol, build-gmc-feed, daily-aggregate)
│   │   │   └── lib/          # db, auth, validation
│   │   └── drizzle/          # migrations + schema
│   ├── admin/                # TanStack-frontend
│   │   └── src/routes/       # /products, /orders, /stock, /channels, /finance
│   └── storefront-template/  # Next.js reference-implementation (Aether levert echte)
├── packages/
│   ├── shared/               # types, schemas, constants gedeeld API↔Admin↔Storefront
│   ├── channel-adapters/     # bol/, amazon/, gmc/, storefront/
│   ├── carrier-adapters/     # sendcloud/, myparcel/
│   └── accounting-adapters/  # ubl/, moneybird/, exact/, csv/
├── docs/                     # deze docs
└── scripts/                  # seed-data, dev-bootstrap
```

## Plugin-architectuur

### Channel-adapter interface

```typescript
// packages/channel-adapters/src/interface.ts
export interface ChannelAdapter {
  slug: string;                       // 'bol' | 'amazon' | 'gmc' | 'storefront-koffie'
  capabilities: {
    catalog: 'push' | 'pull' | 'feed';
    orders: 'poll' | 'webhook' | 'none';
    inventory: 'push' | 'feed' | 'none';
  };

  // Catalog
  buildListings(products: CanonicalProduct[]): Promise<ChannelListing[]>;
  pushCatalog?(listings: ChannelListing[]): Promise<void>;
  generateFeed?(listings: ChannelListing[]): Promise<{ url: string; format: string }>;

  // Orders
  pollOrders?(since: Date): Promise<CanonicalOrder[]>;
  acceptWebhook?(payload: unknown, headers: Headers): Promise<CanonicalOrder | null>;

  // Inventory
  pushInventory(updates: InventoryUpdate[]): Promise<void>;

  // Shipment notification
  notifyShipped?(orderId: string, tracking: TrackingInfo): Promise<void>;
}
```

Elke channel implementeert deze interface. CRM-core praat NOOIT direct met Bol-API — altijd via adapter. Dit maakt:
- Testen makkelijk (mock-adapter)
- Bol API v11 upgrade lokaal (één file vervangen)
- Nieuwe marketplace (bv Marktplaats) toevoegen = nieuw adapter-bestand

### Carrier-adapter interface

```typescript
export interface CarrierAdapter {
  slug: string;                       // 'sendcloud' | 'myparcel'
  createLabel(input: ShipmentInput): Promise<ShipmentLabel>;
  acceptTrackingWebhook(payload: unknown): Promise<TrackingEvent>;
}
```

### Accounting-adapter interface

```typescript
export interface AccountingAdapter {
  slug: string;                       // 'ubl' | 'moneybird' | 'exact' | 'csv'
  exportDailyJournal(input: JournalEntry[]): Promise<{ ref: string }>;
  pushExternalInvoice?(invoice: ExternalInvoice): Promise<{ ref: string }>;
}
```

## Data-flow — kritieke paden

### 1. Inkomende order (Bol)

```
[BullMQ cron 5 min]
   ↓ poll-bol-orders job
   ↓ adapter.pollOrders(lastSeenAt)
   ↓ for each Bol-order:
       ↓ upsert customers (cross-channel match op email+postcode)
       ↓ upsert order(channel='bol', external_id, status='OPEN')
       ↓ upsert order_items
       ↓ create inventory_reservations (per item, per location via allocator)
       ↓ create btw_record (klantland, tarief, bedragen)
       ↓ emit event 'order.received'
   ↓ persist order — Bol-API verliest 'm na 48u
```

### 2. Verzending → BTW + boekhouding

```
[admin clicks "Genereer label"]
   ↓ POST /orders/:id/ship
   ↓ carrier-adapter.createLabel()
   ↓ on success:
       ↓ shipment-record + label-PDF
       ↓ inventory_movements (-1 on_hand, -1 committed)
       ↓ reservation → consumed
       ↓ ledger_entry (omzet/BTW/COGS) per LineItem
       ↓ adapter.notifyShipped(tracking) naar oorsprong-channel
   ↓ order.status = 'SHIPPED'

[BullMQ daily 02:00]
   ↓ daily-aggregate job
   ↓ groepeer ledger_entries gisteren per (channel, btw_tarief)
   ↓ accounting-adapter.exportDailyJournal()
   ↓ schrijf 1 external_sales_invoice per groep naar Moneybird
   ↓ ook UBL-bestand naar /storage/ubl/YYYY-MM-DD/
```

### 3. Voorraad-sync naar channels

```
[event: inventory.changed]
   ↓ debounce 30s per item (anders Amazon-throttle)
   ↓ for each channel met item enabled:
       ↓ adapter.pushInventory([{sku, qty, locationId}])
   ↓ Bol: PUT /offers/{id}/stock
   ↓ Amazon: queue feed (batched, 1×/15min)
   ↓ GMC: triggert XML-rebuild (next daily refresh)
   ↓ Storefronts: cache-invalidate via webhook
```

## API-contract (voor Aether's storefronts)

Storefronts gebruiken **per-shop API-token** + REST-API. Alle endpoints onder `/storefront/v1/*`.

### Read-paden (publiek voor de winkel)

| Endpoint | Doel |
|---|---|
| `GET /storefront/v1/products` | Productenlijst, filterable op `category, brand, available, search` |
| `GET /storefront/v1/products/:slug` | Product detail incl varianten + foto's + voorraad-flag |
| `GET /storefront/v1/categories` | Categoriestructuur |
| `GET /storefront/v1/availability/:variantId` | Live voorraad-check (cached 30s) |

### Write-paden (transactional)

| Endpoint | Doel |
|---|---|
| `POST /storefront/v1/cart` | Maak cart aan (server-side voorraad-reservatie 15 min) |
| `POST /storefront/v1/cart/:id/items` | Voeg item toe (probeert reservatie) |
| `POST /storefront/v1/checkout` | Checkout-init: BTW-berekening + verzendkosten |
| `POST /storefront/v1/orders` | Order plaatsen (na succesvolle betaling — payment-provider apart) |
| `GET /storefront/v1/orders/:id` | Order-status (klant-track) |

### Auth-model storefront

```
Storefront → CRM:  Authorization: Bearer ${STOREFRONT_TOKEN}
Klant → Storefront → CRM:  X-Customer-Token: ${SESSION_JWT}  (optioneel, voor logged-in)
```

### Voorraad-zichtbaarheid

Storefront kent **geen exacte aantallen** — alleen `available` (boolean) + `low_stock` (boolean op qty<5). Echte voorraad-engine zit in CRM. Voorkomt scraping-bias en geeft buffer voor channel-allocaties.

## Auth & secrets

### V1 simplistic
- **Admin-login**: 1 user (operator), Lucia + bcrypt password, sessie-cookie 30d.
- **API-tokens**: per storefront/channel een token-record (`api_tokens(token_hash, scope, label)`).
- **Channel-credentials** (Bol client_id/secret, Amazon LWA-refresh-token, Moneybird OAuth-token): in encrypted Postgres-table met `pgcrypto`, key uit `CHANNEL_SECRET_KEY` env-var.
- **2FA**: V2.

### Secrets-management
`.env` in repo (gitignored), `.env.example` checked-in. Geen vendor (Vault/Doppler) V1.

## Background jobs (BullMQ)

| Job | Schedule | Doel |
|---|---|---|
| `poll-bol-orders` | elke 5 min | nieuwe Bol-orders ophalen, persistent maken |
| `poll-amazon-orders` | elke 5 min (1 req/min limiet!) | idem voor Amazon |
| `build-gmc-feed` | elke 1u + on inventory.changed | XML-feed regenereren naar `/storage/feeds/gmc.xml` |
| `push-channel-inventory` | event-driven, debounced 30s | voorraad-update doorduwen |
| `daily-ledger-aggregate` | cron 02:00 | gisteren's ledger aggregeren naar Moneybird-invoices |
| `vies-validate-vat` | on-demand | B2B-BTW-nummer-check via VIES |
| `cleanup-expired-reservations` | elke 1 min | 15-min cart-reserveringen vrijgeven |

## Idempotency & audit

### Idempotency op writes
Alle POST-endpoints accepteren `Idempotency-Key` header (UUID). Eerste request slaat op, herhaalde requests met zelfde key krijgen cached response. Tabel `idempotency_keys(key, response_hash, response_body, expires_at)`.

### Audit-trail
Aparte tabel `audit_log(id, actor_type, actor_id, action, entity_type, entity_id, before, after, ip, ts)`. Triggers op `orders`, `inventory_movements`, `purchase_orders`, `ledger_entries`. Read-only voor admin-UI.

## Deployment-topologie V1

```
hoi (Windows PC)
├── Postgres (Docker Desktop of native Windows-service)  :5432
├── Redis (Docker)                                        :6379
├── webshop-crm/apps/api          (tsx watch, dev)        :7300
├── webshop-crm/apps/admin        (vite dev)              :7301
├── webshop-crm/apps/storefront   (next dev)              :7302
├── cloudflared tunnel api.* → :7300                      (voor webhooks Bol/Sendcloud)
└── cloudflared tunnel shop1.* → :7302                    (publieke storefront)
```

V2 productie: VPS (Hetzner/DigitalOcean) met Caddy reverse-proxy, Docker-compose, off-site Postgres-backup.

## Migratie-strategie

Drizzle-migrations in `apps/api/drizzle/`. Elke wijziging = nieuwe SQL-file, expliciete `up`/`down`. Auto-apply bij dev-startup, productie via `pnpm db:migrate` step.

## Testing

- **Unit**: Vitest, focus op domain-logic (allocator, BTW-berekening, ledger-entries).
- **Integration**: Postgres-testcontainer + adapter-mocks; happy-path per kanaal.
- **E2E V1**: 1 Playwright-flow (admin-login → product aanmaken → order-import-mock → ship → ledger-entry zichtbaar).

## Aandachtspunten / risico's

| Risico | Mitigatie |
|---|---|
| Bol order-window 48u → orders kwijtraken bij downtime | Cron 5min + alarm bij failed pollen >2 cycles |
| Amazon Orders-API 1/min throttle | Polling-interval respecteren + Reports-API voor backfill |
| GS1-EAN ontbreekt | Pre-launch checklist; channels weigeren producten zonder valid GTIN |
| Float-fouten in BTW-bedragen | `numeric(12,4)` in schema; nooit `float`/`number` voor money |
| Lokale Postgres-crash | Daily `pg_dump` cronjob naar `storage/backups/` + 7-dag rotation |
| Cloudflared tunnel-URL wisselt | Named tunnel (eenmalige setup) ipv quick-tunnel voor stabiele webhook-URLs |
