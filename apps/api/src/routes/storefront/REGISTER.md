# REGISTER — storefront (Agent 7, Wave 1)

Publieke storefront-API onder `/api/storefront/v1/*`. **GEEN `requireAuth`** —
dit is de publieke API waar de webshops (Wave 3) op draaien. Shop-scoping is
verplicht via middleware (zie "Shop-scoping-conventie").

## Mount (Atlas voegt toe aan `routes/index.ts`)

```ts
// import bovenaan:
import { storefrontRoutes } from './storefront/index.js';

// in de feature-registration-slot:
apiRoutes.route('/storefront/v1', storefrontRoutes);
```

> LET OP: monteer op `'/storefront/v1'` (met v-prefix in het pad), NIET op
> `'/storefront'`. De router-interne paden zijn `/products`, `/cart`, etc.

### CORS
De storefronts (Wave 3) draaien op andere origins/domeinen dan de admin. De
huidige `index.ts` CORS-allowlist staat alleen `ADMIN_PUBLIC_URL` + dev-localhost
toe. Voor productie moet Atlas/Wave-3 de storefront-origins toevoegen (of
`/api/storefront/*` een ruimere CORS-policy geven). **Verzoek**: voeg de
storefront-domeinen toe aan de CORS-origin-allowlist, of sta `*` toe specifiek
voor het `/api/storefront/v1/*`-pad (publieke read-API). Niet-blokkerend voor
server-side storefront-render (SSR doet geen CORS).

### Idempotency
De globale `idempotency`-middleware draait op `/api/*`. Storefront-writes
(POST /cart, add-item, checkout) lopen daar dus ook doorheen. Dat is prima —
storefronts kunnen een `Idempotency-Key` meesturen op checkout om dubbele
orders bij retries te voorkomen. Geen actie nodig.

## Shop-scoping-conventie (de "token")

Elke request MOET een shop identificeren. Resolutie-volgorde (`_shop.ts`):

1. Header `X-Shop-Slug: <slug>`
2. Query  `?shop=<slug>`
3. Header `X-Shop-Domain: <domain>` (custom-domein via reverse-proxy)

- Onbekende of niet-`active` shop → **404 `shop_not_found`**.
- Geen identifier meegegeven → **400 `shop_required`**.
- De resolved `shops`-row wordt op de Hono-context gezet (`c.get('shop')`).

> De storefront-"token" uit het contract = de **shop-identifier** (slug/domain),
> NIET een admin-sessie. De API is publiek; schrijf-flows zijn shop-scoped +
> voorraad-gevalideerd. Cart-sessies gebruiken een aparte, ondoordringbare
> `carts.token` (random base64url, 24 bytes) als publieke handle.

## Endpoints (relatief aan `/api/storefront/v1`)

| Method | Path | Omschrijving |
|---|---|---|
| GET | `/shop` | huidige shop (publiek subset) |
| GET | `/products` | catalogus: published shop_products, price_override toegepast. Query: `limit,offset,search,tag,sort(position\|newest\|price_asc\|price_desc\|title)` |
| GET | `/products/:slug` | product-detail met variants + images + voorraad |
| GET | `/pages/:slug` | CMS-pagina (status=published) + globale active blocks |
| GET | `/menus` | navigatie-menus met geneste items |
| GET | `/blog` | blog-lijst (published, zonder body). Query: `limit,offset,tag` |
| GET | `/blog/:slug` | blog-detail (published, met body) |
| POST | `/cart` | maak cart → `{ cart: { token, ... } }` (201) |
| GET | `/cart/:token` | cart ophalen (regels + voorraad + subtotal) |
| POST | `/cart/:token/items` | add item `{ variantId, quantity? }` — voorraad-check, 422 bij tekort |
| PATCH | `/cart/:token/items/:itemId` | qty wijzigen `{ quantity }` (0 = verwijderen) |
| DELETE | `/cart/:token/items/:itemId` | regel verwijderen |
| DELETE | `/cart/:token/items` | cart legen |
| POST | `/cart/:token/checkout` | order plaatsen (zie hieronder) |

### Checkout-body
```jsonc
{
  "email": "buyer@example.com",      // verplicht
  "firstName": "Test", "lastName": "Koper",
  "phone": "...", "company": "...", "vatNumber": "...",
  "acceptsMarketing": false,
  "note": "...",
  "shippingAddress": { "line1": "Teststraat 1", "postcode": "1234 AB",
                       "city": "Amsterdam", "country": "NL" }, // verplicht
  "billingAddress": { ... },         // optioneel; valt terug op shipping
  "shippingTotal": "4.9500"          // string, default "0"
}
```
Checkout (alles in 1 transactie via `runInTransactionWithAudit`):
- voorraad-her-check + decrement (`available -= qty`, `committed += qty`) over locations
- upsert `customers` op UNIQUE(shop_id, email)
- per-shop `order_number` = `<2-letter-shopslug-prefix>-<1001+order_count>` (bv `CR-1001`)
- `orders` + `order_items` (prijs/btw/marge gesnapshot), btw uit variant.tax_class (21/9/0)
- payment **mock** → `order_payments(status='paid')` + `orders.financial_status='paid'`, `status='paid'`
- update customer-aggregaten (`orders_count`, `total_spent`)
- cart legen + audit-row (`entityType='order'`, `action='create'`)

## Schema-verzoeken (kolommen die ontbreken)
**Geen.** Alle benodigde tabellen/kolommen bestaan in DB-SCHEMA-V2.

Twee V1-aannames die ik noteer (geen schema-change nodig, wel goed om te weten):
1. **Prijs = bruto (incl. btw).** btw_amount per regel berekend als
   `lineTotal * rate/(100+rate)`. Als de shop netto-prijzen voert
   (`shops.vat_config.priceIncludesVat=false`), moet de btw-logica later
   gesplitst worden. Voor V1 negeer ik `vat_config` en neem ik bruto aan.
2. **Voorraad-decrement bij checkout** verlaagt `inventory_levels.available`
   en verhoogt `committed` (greedy over locations), maar schrijft GEEN
   `inventory_movements`-row (anders zou ik in stock-domein-territorium komen).
   Als een echte movement-trail bij verkoop gewenst is, kan dat later via
   `applyDeltaAndRecompute` + movement-insert worden toegevoegd.

## Seed/env-verzoeken
- **Geen env nodig** (geen storefront-API-key; shop-scoping via slug/domain).
- **Seed-suggestie (optioneel)**: voor een werkende Wave-3-demo is een
  gepubliceerd product in minstens één `active` shop handig:
  een shop (`status='active'`), een product + variant + inventory_item +
  inventory_level (available>0), en een `shop_products`-rij met
  `published=true`. De E2E-test doet dit zelf (en ruimt op), dus dit is
  alleen nodig voor een persistente demo-storefront. Atlas mag dit aan de
  bestaande seed-flow hangen indien gewenst.

## Tests
- `src/routes/storefront/__tests__/storefront.test.ts` — **E2E tegen de echte
  Postgres** (geen mocks). Seed test-shop + product + voorraad + CMS, doorloopt
  catalog/content/cart/checkout, verifieert order + voorraad-decrement +
  customer-aggregaten in DB, en ruimt alle test-rijen op (`afterAll`).
- Draaien:
  ```
  pnpm -C "C:\ClaudeAgents\shared\from-agent1\webshop-crm" --filter @webshop-crm/api test -- src/routes/storefront
  ```
  Resultaat bij oplevering: **10/10 passed**.

## Folder-eigendom (strikt)
Alle nieuwe files staan onder `apps/api/src/routes/storefront/`:
`index.ts`, `catalog.ts`, `content.ts`, `cart.ts`, `checkout.ts`,
`_serialize.ts`, `_shop.ts`, `_pricing.ts`, `__tests__/storefront.test.ts`,
`REGISTER.md`. Geen andere folder, schema-file of `routes/index.ts` aangeraakt.
```
