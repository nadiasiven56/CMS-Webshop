# Database Schema — Webshop-CRM V1

**Versie**: 0.1 (concept, referentie voor Drizzle-implementatie)
**Auteur**: Atlas (agent1)
**Datum**: 2026-05-09

Postgres 16 + Drizzle. SQL hieronder is **referentie** — definitieve syntax komt uit Drizzle-schema-files in `apps/api/drizzle/`. Alle bedragen `numeric(12,4)` (4 decimalen voor float-loze BTW-rekenkunde).

## Naming-conventies
- snake_case voor tabellen + kolommen
- Plurals voor tabellen (`products`, niet `product`)
- `id` is altijd `uuid` met `default gen_random_uuid()`
- `created_at`/`updated_at` op vrijwel alles, `timestamptz` met `default now()`
- FK's altijd `<entity>_id`
- Soft-delete via `deleted_at timestamptz` waar versie-history nodig is; harde delete elders

## Modules + dependencies

```
auth → users → api_tokens
catalog → products → variants → inventory_items
locations
inventory_levels (items × locations)
inventory_movements (audit)
inventory_reservations (cart/order holds)
suppliers → purchase_orders → purchase_order_items
customers → orders → order_items → fulfillments → shipments
orders → btw_records → ledger_entries
channels → channel_products → channel_listings
accounting_connections → accounting_exports
audit_log (cross-cutting)
idempotency_keys (cross-cutting)
```

---

## SQL-referentie (V1)

```sql
-- ============================================================
-- AUTH
-- ============================================================
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  scope text not null,           -- 'storefront:shop1', 'channel:bol', 'admin:read'
  label text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- LOCATIONS (multi-warehouse-ready, V1 default 'main')
-- ============================================================
create table locations (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,            -- 'main', 'dropship-supplier-x'
  name text not null,
  type text not null default 'warehouse', -- warehouse, dropship, virtual
  priority int not null default 100,
  address jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- CATALOG
-- ============================================================
create table products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description_html text,
  vendor text,
  product_type text,
  status text not null default 'draft',  -- draft, active, archived
  tags text[] not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null,                    -- 'Color', 'Size'
  position int not null default 0
);

create table product_option_values (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references product_options(id) on delete cascade,
  value text not null,                   -- 'Red', 'M'
  position int not null default 0
);

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  url text not null,
  alt text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  sku text unique not null,
  price numeric(12,4) not null,
  compare_at_price numeric(12,4),
  cost_price numeric(12,4),              -- inkoop, voor marge-berekening
  weight_g int,
  length_mm int, width_mm int, height_mm int,
  barcode text,                          -- EAN/UPC
  selected_options jsonb not null default '{}', -- {"Color": "Red", "Size": "M"}
  position int not null default 0,
  taxable boolean not null default true,
  tax_class text not null default 'standard', -- standard|reduced|zero|exempt
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid unique not null references variants(id) on delete cascade,
  sku text unique not null,              -- duplicaat met variant.sku voor query-ease
  tracked boolean not null default true,
  requires_shipping boolean not null default true,
  gtin text,                             -- 13 of 14 digits
  gtin_is_gs1_registered boolean not null default false,
  hs_code text,                          -- harmonized system (douane)
  country_of_origin text,                -- ISO-2
  created_at timestamptz not null default now()
);
create index inventory_items_gtin_idx on inventory_items(gtin) where gtin is not null;

create table inventory_levels (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inventory_items(id) on delete cascade,
  location_id uuid not null references locations(id),
  on_hand int not null default 0,        -- fysiek aanwezig
  available int not null default 0,      -- vrij verkoopbaar (= on_hand - committed)
  committed int not null default 0,      -- in active orders
  incoming int not null default 0,       -- verwacht uit PO
  min_stock int,                         -- triggert low_stock event
  reorder_point int,
  reorder_qty int,
  updated_at timestamptz not null default now(),
  unique(item_id, location_id)
);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inventory_items(id) on delete cascade,
  location_id uuid not null references locations(id),
  delta int not null,                    -- +5 receive, -3 ship, +1 adjust
  reason text not null,                  -- 'sale', 'return', 'po_receive', 'adjust', 'transfer'
  ref_type text,                         -- 'order', 'po', 'manual'
  ref_id uuid,
  actor_id uuid,                         -- user/job
  note text,
  created_at timestamptz not null default now()
);
create index inventory_movements_item_idx on inventory_movements(item_id, created_at desc);

create table inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inventory_items(id) on delete cascade,
  location_id uuid not null references locations(id),
  quantity int not null check (quantity > 0),
  reason text not null,                  -- 'cart', 'order', 'manual'
  ref_type text not null,                -- 'cart', 'order'
  ref_id uuid not null,
  expires_at timestamptz,                -- null = pas op shipment of cancel
  created_at timestamptz not null default now()
);
create index inventory_reservations_expires_idx on inventory_reservations(expires_at) where expires_at is not null;

-- ============================================================
-- SUPPLIERS + PURCHASE ORDERS
-- ============================================================
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  address jsonb,
  vat_number text,
  currency text not null default 'EUR',
  lead_time_days int,
  payment_terms text,                    -- '30 dagen', 'netto'
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,           -- 'PO-2026-0001'
  supplier_id uuid not null references suppliers(id),
  location_id uuid not null references locations(id),
  status text not null default 'draft',  -- draft, sent, confirmed, partial_received, received, closed, cancelled
  expected_at date,
  total_excl_vat numeric(12,4) not null default 0,
  total_vat numeric(12,4) not null default 0,
  total_incl_vat numeric(12,4) not null default 0,
  currency text not null default 'EUR',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz
);

create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  item_id uuid not null references inventory_items(id),
  ordered_qty int not null,
  received_qty int not null default 0,
  unit_cost numeric(12,4) not null,
  vat_rate numeric(5,4) not null default 0.21,
  line_total_excl numeric(12,4) not null,
  line_total_vat numeric(12,4) not null
);

-- ============================================================
-- CUSTOMERS
-- ============================================================
create table customers (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  first_name text,
  last_name text,
  vat_number text,                       -- B2B
  vat_validated_at timestamptz,          -- VIES-check ts
  is_business boolean not null default false,
  default_billing jsonb,                 -- {address1, postcode, city, country}
  default_shipping jsonb,
  external_ids jsonb not null default '{}', -- {"bol": "B-1234", "amazon": "A-5678"}
  created_at timestamptz not null default now(),
  unique(email)                           -- soft-unique; bij identieke email mergen
);

-- ============================================================
-- ORDERS
-- ============================================================
create table orders (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,           -- 'ORD-2026-000001'
  channel_id uuid references channels(id), -- nullable voor admin-handmatig
  external_id text,                      -- 'BOL-2026-...' of 'AMZ-...'
  customer_id uuid references customers(id),
  status text not null default 'open',   -- open, allocated, picked, shipped, delivered, cancelled, refunded
  financial_status text not null default 'pending', -- pending, authorized, paid, partially_refunded, refunded
  fulfillment_status text not null default 'unfulfilled', -- unfulfilled, partial, fulfilled
  currency text not null default 'EUR',
  subtotal_excl_vat numeric(12,4) not null default 0,
  total_vat numeric(12,4) not null default 0,
  shipping_excl_vat numeric(12,4) not null default 0,
  shipping_vat numeric(12,4) not null default 0,
  discount_excl_vat numeric(12,4) not null default 0,
  total_incl_vat numeric(12,4) not null default 0,
  billing_address jsonb,
  shipping_address jsonb,
  note text,
  placed_at timestamptz not null default now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  external_payload jsonb,                -- raw channel-payload voor debugging
  unique(channel_id, external_id)
);
create index orders_status_idx on orders(status, placed_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  variant_id uuid references variants(id),
  sku text not null,                     -- snapshot
  title text not null,                   -- snapshot
  quantity int not null check (quantity > 0),
  unit_price_excl_vat numeric(12,4) not null,
  vat_rate numeric(5,4) not null,        -- 0.21, 0.09, 0.00
  vat_amount numeric(12,4) not null,
  line_total_excl numeric(12,4) not null,
  line_total_incl numeric(12,4) not null,
  cost_price_snapshot numeric(12,4),     -- cogs op moment van order
  discount_excl numeric(12,4) not null default 0
);

create table btw_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references orders(id) on delete cascade,
  customer_country text not null,        -- ISO-2
  customer_type text not null,           -- 'b2c' | 'b2b'
  customer_vat_number text,
  vat_validated_at timestamptz,
  applied_scheme text not null,          -- 'nl-domestic', 'oss', 'ioss', 'reverse-charge', 'export'
  invoice_number text not null,          -- BTW-conform sequentieel
  invoice_date date not null,
  delivery_date date,
  total_excl_vat numeric(12,4) not null,
  total_vat numeric(12,4) not null,
  vat_breakdown jsonb not null,          -- {"21": 12.50, "9": 3.20}
  created_at timestamptz not null default now()
);

create table fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  location_id uuid not null references locations(id),
  status text not null default 'pending', -- pending, picked, packed, shipped, delivered, cancelled
  shipped_at timestamptz,
  created_at timestamptz not null default now()
);

create table fulfillment_items (
  id uuid primary key default gen_random_uuid(),
  fulfillment_id uuid not null references fulfillments(id) on delete cascade,
  order_item_id uuid not null references order_items(id),
  quantity int not null
);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  fulfillment_id uuid not null references fulfillments(id) on delete cascade,
  carrier text not null,                 -- 'postnl', 'dhl', 'dpd'
  service_code text,                     -- '3085', 'EXPRESS'
  tracking_number text,
  tracking_url text,
  label_url text,
  label_format text,                     -- 'pdf', 'zpl'
  weight_g int,
  cost_excl_vat numeric(12,4),
  cost_vat numeric(12,4),
  status text not null default 'created', -- created, announced, in_transit, delivered, returned
  status_history jsonb not null default '[]',
  external_payload jsonb,
  created_at timestamptz not null default now()
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  amount numeric(12,4) not null,
  reason text,
  note text,
  external_id text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- LEDGER (eigen winst/verlies engine)
-- ============================================================
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  account text not null,                 -- 'omzet_21', 'omzet_9', 'omzet_oss_de_19', 'cogs', 'btw_te_betalen', 'verzendkosten'
  amount numeric(12,4) not null,         -- positief = credit, negatief = debit
  ref_type text not null,                -- 'order', 'po', 'shipment', 'refund', 'adjust'
  ref_id uuid,
  channel_id uuid references channels(id),
  variant_id uuid references variants(id),
  vat_rate numeric(5,4),
  description text,
  created_at timestamptz not null default now()
);
create index ledger_entries_date_account_idx on ledger_entries(entry_date, account);

-- ============================================================
-- CHANNELS (Bol, Amazon, GMC, eigen webshop)
-- ============================================================
create table channels (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,             -- 'bol', 'amazon-nl', 'gmc', 'shop-koffie'
  name text not null,
  type text not null,                    -- 'marketplace', 'feed', 'storefront'
  active boolean not null default false,
  config jsonb not null default '{}',    -- adapter-specific (urls, etc)
  credentials_encrypted text,            -- pgcrypto-encrypted JSON
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table channel_products (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  enabled boolean not null default false,
  price_modifier_pct numeric(5,4) not null default 0, -- 0.10 = +10%
  category_override text,
  title_override text,
  description_override text,
  unique(channel_id, product_id)
);

create table channel_listings (
  -- mirror van wat momenteel daadwerkelijk live staat op het kanaal
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  variant_id uuid not null references variants(id) on delete cascade,
  external_id text,                      -- bol offer-id, amazon listing-id
  status text not null,                  -- 'live', 'pending', 'rejected', 'paused'
  last_pushed_at timestamptz,
  last_payload jsonb,
  unique(channel_id, variant_id)
);

-- ============================================================
-- ACCOUNTING (export-laag)
-- ============================================================
create table accounting_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null,                -- 'moneybird', 'exact', 'ubl-file', 'csv'
  label text not null,
  credentials_encrypted text,            -- OAuth-tokens encrypted
  config jsonb not null default '{}',    -- administration_id etc
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table accounting_exports (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references accounting_connections(id),
  period_start date not null,
  period_end date not null,
  type text not null,                    -- 'daily-aggregate', 'oss-quarter', 'icp-quarter', 'ubl-batch'
  status text not null default 'pending', -- pending, success, failed
  file_path text,                        -- voor UBL-files
  external_ref text,                     -- moneybird-invoice-id
  payload jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ============================================================
-- CROSS-CUTTING
-- ============================================================
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,              -- 'user', 'job', 'webhook', 'api'
  actor_id text,
  action text not null,                  -- 'create', 'update', 'delete', 'ship', 'cancel'
  entity_type text not null,             -- 'order', 'product', 'inventory_movement'
  entity_id uuid,
  before jsonb,
  after jsonb,
  ip text,
  ts timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log(entity_type, entity_id, ts desc);

create table idempotency_keys (
  key text primary key,
  scope text not null,                   -- 'orders.create', 'shipments.create'
  response_status int not null,
  response_body jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
```

## Triggers (V1 minimum)

1. **`updated_at` auto-update** op alle tabellen die kolom hebben.
2. **Audit-log** op `orders`, `inventory_movements`, `purchase_orders`, `ledger_entries` (insert/update/delete → audit-row).
3. **Inventory consistency check**: trigger op `inventory_levels` die afdwingt `available = on_hand - committed`.

## Seed-data V1

- 1 location: `main` (default-warehouse)
- 1 user: operator
- BTW-tarieven NL+EU 2026 (lookup-tabel apart, niet in schema hierboven — komt in `apps/api/src/domain/vat/rates.ts`)
- 27 EU-landen + ISO-codes
- 1 default-channel: `gmc` (disabled tot operator inschakelt)

## Indexen die later toegevoegd kunnen worden

Pas op moment van performance-issue, niet upfront:
- `orders(channel_id, placed_at)` voor channel-rapportages
- `ledger_entries(channel_id, entry_date)` voor channel-financieel
- `inventory_movements(item_id, created_at)` voor item-history (al toegevoegd)
- Full-text op `products(title, description_html)` voor admin-search

## Migratie-discipline

- Elke migration is **sql + reversible** (Drizzle `up`/`down`)
- Geen "drop column" zonder eerst data-migratie
- Schema-changes die channel-listings beinvloeden = ALTIJD met channel-resync-flag
