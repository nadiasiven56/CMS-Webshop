# DB-Schema V2 — Multi-shop CMS + Commerce + Financieel

**Auteur**: Atlas · **Datum**: 2026-06-01 · **Migratie**: `0001_cms_commerce_finance.sql`

Dit is het **fundament-contract** voor de swarm. Alle Wave-1/2/3-agents bouwen
hier tegenaan. **Conventies** (1-op-1 met Fase-1 schema):

- PK: `uuid('id').primaryKey().defaultRandom()` → SQL `uuid DEFAULT gen_random_uuid()`
- Geld: `numeric('x', { precision: 12, scale: 4 })` → **string** in TS (Money-helper)
- Tijd: `timestamp(..., { withTimezone: true })`, `created_at`/`updated_at` met `defaultNow()`
- `updated_at`-trigger via bestaande `set_updated_at()` functie (per tabel een trigger)
- 1 file per tabel in `apps/api/src/db/schema/`, re-export in `schema/index.ts`
- FK met expliciete `onDelete` ('cascade' voor kind-records, 'restrict'/'set null' anders)

---

## 1. Multi-shop (kern — alles hangt hieraan)

### `shops`
De tenant-as: elke eigen webshop/merk. Gedeelde catalogus/voorraad, eigen storefront.
| kolom | type | noot |
|---|---|---|
| id | uuid PK | |
| slug | text unique notNull | 'crema', 'pawfect' |
| name | text notNull | "Crema & Co." |
| domain | text unique | 'crema.nl' (nullable in dev) |
| locale | text notNull default 'nl-NL' | |
| currency | text notNull default 'EUR' | |
| status | text notNull default 'active' | active\|draft\|paused |
| branding | jsonb notNull default '{}' | {logoUrl, primaryColor, accentColor, font, theme} |
| vat_config | jsonb notNull default '{}' | {priceIncludesVat:bool, defaultCountry:'NL', oss:bool} |
| default_location_id | uuid FK→locations(id) set null | |
| support_email | text | |
| created_at / updated_at | timestamptz | trigger |

### `shop_products` (join — gedeelde catalogus, per shop publiceren)
| kolom | type | noot |
|---|---|---|
| id | uuid PK | |
| shop_id | uuid FK→shops cascade notNull | |
| product_id | uuid FK→products cascade notNull | |
| published | boolean notNull default false | |
| price_override | numeric(12,4) | null = variant-prijs |
| position | integer notNull default 0 | |
| published_at | timestamptz | |
| UNIQUE(shop_id, product_id) | | |

---

## 2. CMS (content per shop)

### `cms_pages`
| id uuid PK · shop_id FK→shops cascade · slug text · title text · status text default 'draft' (draft\|published) · template text default 'default' · blocks jsonb default '[]' (page-builder block-array) · seo jsonb default '{}' ({title,description,ogImage,noindex}) · published_at timestamptz · created_at/updated_at (trigger) · **UNIQUE(shop_id, slug)** |

### `cms_blocks` (herbruikbare/globale secties: header, footer, banners)
| id uuid PK · shop_id FK→shops cascade · key text (notNull) · type text (hero\|richtext\|banner\|product-grid\|html) · content jsonb default '{}' · active boolean default true · created_at/updated_at · **UNIQUE(shop_id, key)** |

### `cms_menus`
| id uuid PK · shop_id FK→shops cascade · location text (header\|footer\|sidebar) · name text · created_at/updated_at · **UNIQUE(shop_id, location, name)** |

### `cms_menu_items`
| id uuid PK · menu_id FK→cms_menus cascade · parent_id uuid FK→cms_menu_items set null (self) · label text · url text · position integer default 0 · created_at |

### `blog_posts`
| id uuid PK · shop_id FK→shops cascade · slug text · title text · excerpt text · body_html text · cover_image text · status text default 'draft' · author text · tags text[] default '{}' · seo jsonb default '{}' · published_at timestamptz · created_at/updated_at · **UNIQUE(shop_id, slug)** |

### `cms_media` (media-library — shop_id NULL = globaal)
| id uuid PK · shop_id uuid FK→shops cascade (nullable) · url text · filename text · mime text · size_bytes integer · width integer · height integer · alt text · folder text default 'uploads' · created_at |

### `cms_redirects`
| id uuid PK · shop_id FK→shops cascade · from_path text · to_path text · status_code integer default 301 · created_at · **UNIQUE(shop_id, from_path)** |

---

## 3. Commerce

### `customers`
| id uuid PK · shop_id FK→shops cascade · email text · first_name text · last_name text · phone text · company text · vat_number text (B2B) · accepts_marketing boolean default false · tags text[] default '{}' · notes text · orders_count integer default 0 · total_spent numeric(12,4) default '0' · created_at/updated_at · **UNIQUE(shop_id, email)** |

### `customer_addresses`
| id uuid PK · customer_id FK→customers cascade · type text (billing\|shipping) · is_default boolean default false · name text · line1 text · line2 text · postcode text · city text · province text · country text (ISO2) · phone text · created_at |

### `orders`
| id uuid PK · shop_id FK→shops restrict · order_number text notNull (per-shop, bv 'CR-1001') · customer_id uuid FK→customers set null · email text · channel text default 'web' (web\|bol\|amazon\|gmc) · status text default 'pending' (pending\|paid\|fulfilled\|shipped\|delivered\|cancelled\|refunded) · financial_status text default 'pending' (pending\|paid\|partially_refunded\|refunded) · fulfillment_status text default 'unfulfilled' · currency text default 'EUR' · subtotal numeric(12,4) · discount_total numeric(12,4) default '0' · shipping_total numeric(12,4) default '0' · tax_total numeric(12,4) default '0' · grand_total numeric(12,4) · billing_address jsonb · shipping_address jsonb · note text · placed_at timestamptz · created_at/updated_at · **UNIQUE(shop_id, order_number)** · INDEX(shop_id, status, created_at) |

### `order_items`
| id uuid PK · order_id FK→orders cascade · variant_id uuid FK→variants set null · sku text · title text · quantity integer notNull · unit_price numeric(12,4) · tax_rate numeric(5,2) default '21' · tax_amount numeric(12,4) default '0' · cost_price numeric(12,4) (voor marge) · line_total numeric(12,4) |

### `order_payments`
| id uuid PK · order_id FK→orders cascade · provider text (mock\|ideal\|card\|bol) · amount numeric(12,4) · status text default 'pending' (pending\|paid\|failed\|refunded) · reference text · paid_at timestamptz · created_at |

### `order_fulfillments`
| id uuid PK · order_id FK→orders cascade · location_id uuid FK→locations set null · status text default 'pending' · carrier text · tracking_code text · tracking_url text · shipped_at timestamptz · created_at |

### `carts` + `cart_items` (storefront)
- `carts`: id uuid PK · shop_id FK→shops cascade · token text unique notNull · customer_id uuid FK→customers set null · currency text default 'EUR' · expires_at timestamptz · created_at/updated_at
- `cart_items`: id uuid PK · cart_id FK→carts cascade · variant_id FK→variants cascade · quantity integer notNull · unit_price numeric(12,4) · UNIQUE(cart_id, variant_id)

### `returns` + `return_items` (RMA)
- `returns`: id uuid PK · shop_id FK→shops cascade · order_id FK→orders set null · status text default 'requested' (requested\|approved\|received\|refunded\|rejected) · reason text · refund_amount numeric(12,4) default '0' · created_at/updated_at
- `return_items`: id uuid PK · return_id FK→returns cascade · order_item_id uuid FK→order_items set null · quantity integer · restock boolean default true

---

## 4. Purchasing (inkoop)

### `suppliers`
| id uuid PK · name text · email text · phone text · address jsonb · lead_time_days integer default 7 · currency text default 'EUR' · notes text · active boolean default true · created_at/updated_at |

### `purchase_orders`
| id uuid PK · supplier_id FK→suppliers restrict · location_id FK→locations set null · reference text · status text default 'draft' (draft\|ordered\|partial\|received\|cancelled) · currency text default 'EUR' · subtotal numeric(12,4) default '0' · tax_total numeric(12,4) default '0' · total numeric(12,4) default '0' · expected_at timestamptz · ordered_at timestamptz · received_at timestamptz · notes text · created_at/updated_at |

### `purchase_order_items`
| id uuid PK · po_id FK→purchase_orders cascade · variant_id FK→variants set null · sku text · quantity integer notNull · unit_cost numeric(12,4) · quantity_received integer default 0 |

---

## 5. Financieel

### `vat_rates` (seed NL + EU)
| id uuid PK · country text (ISO2) · tax_class text (standard\|reduced\|zero) · rate numeric(5,2) · label text · valid_from date default current_date · **UNIQUE(country, tax_class, valid_from)** |

### `ledger_entries`
| id uuid PK · shop_id FK→shops set null · order_id uuid FK→orders set null · entry_date date notNull · account text (revenue\|vat_payable\|cogs\|shipping\|payment_fee\|refund) · debit numeric(12,4) default '0' · credit numeric(12,4) default '0' · currency text default 'EUR' · vat_rate numeric(5,2) · vat_country text · channel text · description text · created_at · INDEX(shop_id, entry_date) |

### `invoices`
| id uuid PK · shop_id FK→shops restrict · order_id uuid FK→orders set null · invoice_number text notNull · type text default 'sales' (sales\|credit) · customer jsonb · lines jsonb default '[]' · subtotal numeric(12,4) · vat_total numeric(12,4) · total numeric(12,4) · status text default 'issued' · ubl_xml text · issued_at timestamptz default now() · created_at · **UNIQUE(shop_id, invoice_number)** |

### `payouts`
| id uuid PK · channel text · amount numeric(12,4) · period text · reference text · received_at timestamptz · created_at |

### `accounting_exports`
| id uuid PK · type text (ubl\|oss\|icp\|moneybird) · period text · status text default 'pending' · file_path text · meta jsonb default '{}' · created_at |

---

## 6. Channels (schema-ready — Wave-1 vult routes later, niet kritiek nu)

### `channels`
| id uuid PK · type text (bol\|amazon\|gmc) · name text · status text default 'disconnected' · credentials jsonb (encrypted via CHANNEL_SECRET_KEY) · config jsonb default '{}' · last_sync_at timestamptz · created_at/updated_at |

### `channel_products`
| id uuid PK · channel_id FK→channels cascade · product_id FK→products cascade · variant_id uuid FK→variants set null · external_id text · status text default 'pending' · price_override numeric(12,4) · last_synced_at timestamptz · UNIQUE(channel_id, variant_id) |

### `channel_orders`
| id uuid PK · channel_id FK→channels cascade · external_order_id text · order_id uuid FK→orders set null · raw jsonb · imported_at timestamptz default now() · UNIQUE(channel_id, external_order_id) |

---

## Migratie-aanpak

1. Eén file `apps/api/src/db/0001-additions/` met alle nieuwe `schema/*.ts` files.
2. Handgeschreven `drizzle/0001_cms_commerce_finance.sql` (additief, `CREATE TABLE IF NOT EXISTS`, FK's, indexes, `updated_at`-triggers).
3. `drizzle/meta/_journal.json` bijwerken met entry idx 1.
4. `schema/index.ts` uitbreiden met nieuwe `export * from`.
5. **NOOIT** 0000 of bestaande tabellen wijzigen — puur additief.

## Triggers (updated_at) nodig op
shops, shop_products(geen updated→nee), cms_pages, cms_blocks, cms_menus, blog_posts,
customers, orders, carts, returns, suppliers, purchase_orders, channels.
(Tabellen met alleen `created_at` krijgen geen trigger.)
