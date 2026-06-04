# Wave 1 — Backend-modules — Integratie-contract

**Coordinator**: Atlas · **Datum**: 2026-06-01

Je bent één van 7 parallelle backend-agents. Houd je STRIKT aan je folder-eigendom.
Atlas (de finalizer) wiret alles daarna in één keer. Dit voorkomt race-condities.

## Wat al af is (NIET overdoen, WEL gebruiken)
- **Echte PostgreSQL 18 draait** op `127.0.0.1:7432` (embedded, UTF8). `.env` in root is correct. DB `webshop_crm`, user/pass `webshop`.
- **45 tabellen** bestaan (migratie 0000 + 0001). Alle CMS/commerce/financieel/multi-shop tabellen staan er — zie `docs/DB-SCHEMA-V2.md` + `apps/api/src/db/schema/*`.
- **API draait** op `127.0.0.1:7300` (tsx watch — herlaadt automatisch bij file-changes). `/health`, `/api/auth/login`, `/api/products/*`, `/api/stock/*` werken.
- Admin-login: `admin@webshop-crm.local` / `admin12345`.

## Gouden regels (overtreden = gebroken build)
1. **Schema is BEVROREN.** Voeg GEEN tabellen/kolommen toe en wijzig schema-files NIET. Heb je een kolom nodig die ontbreekt? Zet het in je REGISTER.md als verzoek aan Atlas — voeg het NIET zelf toe.
2. **Blijf in je folder.** Schrijf alleen in je eigen `apps/api/src/routes/<jouw-module>/` (+ optioneel `apps/api/src/domain/<jouw-module>/` voor pure helpers). Raak GEEN andere route-folders, geen admin, geen schema, geen `routes/index.ts` aan.
3. **Wire NIET zelf in `routes/index.ts`.** Lever in je folder een `REGISTER.md` met exact de import + mount-regel die Atlas moet toevoegen. Atlas doet de wiring atomair.
4. **Gebruik `inArray(col, arr)` — NOOIT `sql\`... = ANY(${arr})\``.** Dat laatste crasht met postgres-js ("op ANY/ALL requires array"). (Dit was een echte Fase-1 bug.)
5. **`db:generate` werkt NIET** in dit project (drizzle-kit ESM-bug). Jij hebt het sowieso niet nodig (schema is bevroren).
6. **Geld = string.** Alle `numeric`-kolommen komen als string uit de driver. Gebruik `packages/shared/src/types/money.ts` helpers. Nooit parseFloat voor berekeningen die je terugschrijft — reken in hele centen of met de Money-helper.

## Verplicht patroon (kopieer van bestaande routes)
Bestudeer `apps/api/src/routes/products/` (CRUD-split per file) en `apps/api/src/routes/stock/index.ts` (1-file router + transactie + audit). Jouw module:
```ts
import { Hono } from 'hono';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
export const <module>Routes = new Hono<{ Variables: AuthVariables }>();
<module>Routes.use('*', requireAuth);     // admin-routes achter auth
// ... GET/POST/PATCH/DELETE met zod-validatie
```
- **Auth**: admin-routes achter `requireAuth`. (storefront-agent: zie z'n eigen sectie — token-auth i.p.v. cookie.)
- **Writes met audit/transactie**: gebruik `runInTransactionWithAudit` uit `apps/api/src/domain/stock/transaction-helpers.js` (herbruikbaar, niet stock-specifiek) waar een audit-trail logisch is (orders, stock-mutaties, etc.).
- **Validatie**: zod op body + query, geef `400 {error:'invalid_request', details}` bij fout (zoals bestaande routes).
- **Serializers**: timestamps → `.toISOString()`, numeric blijft string. Maak een `_serialize.ts` per module.
- **Tests**: voeg minimaal 1 vitest-file toe (`__tests__/` of `*.test.ts`) voor je kern-logica (mag db mocken zoals stock-agent deed).

## Module-toewijzing (folder-eigendom)

### Agent 1 — `routes/shops/` (+ `routes/shop-products/` mag in dezelfde folder)
Tabellen: `shops`, `shop_products`. Endpoints: shops CRUD (`GET/POST/PATCH/DELETE /api/shops`), per-shop product-publicatie (`GET/PUT /api/shops/:id/products` — toggle published + price_override + position). **Plus**: een herbruikbare `shopContext` helper/middleware die `?shop=<slug|id>` of header `X-Shop-Id` resolved naar een shop (andere modules gebruiken dit later — documenteer het in REGISTER.md).

### Agent 2 — `routes/cms/`
Tabellen: `cms_pages`, `cms_blocks`, `cms_menus`, `cms_menu_items`, `blog_posts`, `cms_media`, `cms_redirects`. Endpoints: CRUD per resource onder `/api/cms/*` (bv `/api/cms/pages`, `/api/cms/blocks`, `/api/cms/menus` incl. menu-items nesting, `/api/cms/blog`, `/api/cms/media`, `/api/cms/redirects`). Alles shop-scoped (filter op `shop_id` via query/param). Media-upload: hergebruik `apps/api/src/lib/storage/` (LocalDriver) zoals de image-agent deed.

### Agent 3 — `routes/orders/`
Tabellen: `orders`, `order_items`, `order_payments`, `order_fulfillments`, `returns`, `return_items`. Endpoints: orders list/detail/create/update-status, fulfilment-create (+ tracking), payments, returns (RMA) CRUD. Order-create genereert per-shop `order_number` (bv 'CR-1001'). Status-transities + audit-log. Marge berekenen uit `order_items.cost_price`.

### Agent 4 — `routes/customers/`
Tabellen: `customers`, `customer_addresses`. Endpoints: customers list/detail/create/update/delete (shop-scoped), adressen-CRUD genest, en een read-only orders-historie per klant (join op orders — alleen lezen, niet de orders-routes dupliceren).

### Agent 5 — `routes/purchasing/`
Tabellen: `suppliers`, `purchase_orders`, `purchase_order_items`. Endpoints: suppliers CRUD, purchase-orders CRUD met items, en "ontvangst"-actie (`POST /api/purchasing/po/:id/receive`) die `quantity_received` bijwerkt + (optioneel) een stock-movement triggert via `runInTransactionWithAudit`.

### Agent 6 — `routes/finance/`
Tabellen: `vat_rates`, `ledger_entries`, `invoices`, `payouts`, `accounting_exports`. **Plus** een seed-uitbreiding `apps/api/src/db/seed-vat.ts` (NL 21/9/0 + enkele EU OSS-tarieven) — idempotent. Endpoints: BTW-tarief lookup, ledger-aggregaties (omzet/marge/BTW per shop+kanaal+periode), P&L-overzicht, invoices list/detail, exports-stubs (UBL-XML-generator + OSS-CSV — echte bestand-output, mag mock-aggregatie zijn V1). Documenteer in REGISTER.md dat Atlas `seed-vat` aan de seed-flow moet hangen.

### Agent 7 — `routes/storefront/` (PUBLIEK — let op auth-verschil)
Tabellen (lezen): `shops`, `shop_products`, `products`, `variants`, `product_images`, `cms_pages`, `cms_blocks`, `cms_menus`, `cms_menu_items`, `blog_posts`. (schrijven): `carts`, `cart_items`, `orders`, `order_items`, `customers`. Endpoints onder `/api/storefront/v1/*`, **shop-scoped via een storefront-token of `?shop=<slug>`** (NIET `requireAuth` — dit is de publieke API voor de storefronts). Flows: catalogus-list/detail (alleen `published` shop_products), content (pages/blocks/menus/blog van die shop), cart (create/add/update/remove, server-side), checkout → order-create (payment mock V1: maak order met financial_status 'paid'). Voorraad-check bij add-to-cart. Documenteer de token-conventie in REGISTER.md (Atlas regelt env/seed).

## REGISTER.md template (verplicht in je folder)
```md
# REGISTER — <module>
## Mount (Atlas voegt toe aan routes/index.ts)
import { <module>Routes } from './<module>/index.js';
apiRoutes.route('/<path>', <module>Routes);
## Endpoints
<lijst van method+path>
## Schema-verzoeken (indien kolom mist)
<geen | beschrijf exact>
## Seed/env-verzoeken
<geen | beschrijf>
## Tests
<welke vitest-files, hoe te draaien>
```

## Klaar = 
- Routes geschreven, tsx-watch herlaadt zonder crash (check je geen import-fouten introduceert).
- Minstens 1 happy-path met curl werkt (login → jouw endpoint). DB draait al, dus je KUNT echt testen.
- REGISTER.md compleet. Kort eindrapport: endpoints + of je echt getest hebt + eventuele schema-verzoeken.
