# Wave 2 — Admin-UI — Integratie-contract

**Coordinator**: Atlas · **Datum**: 2026-06-01

Je bent één van 6 parallelle admin-UI-agents. De backend draait écht en is volledig
gewired. Jij maakt admin-pages die op de **echte API** draaien (geen mock meer).

## Wat al af is (gebruiken, niet overdoen)
- **Backend draait** op `127.0.0.1:7300`, alle Wave-1 routes gewired: `/api/shops`, `/api/cms/*`, `/api/orders`, `/api/customers`, `/api/purchasing/*`, `/api/finance/*`, `/api/storefront/v1/*`. **Het exacte endpoint-contract van jouw module staat in de backend-REGISTER.md**, bv. `apps/api/src/routes/orders/REGISTER.md`. LEES DIE.
- **Admin draait** op `127.0.0.1:7301` (vite, proxyt `/api`→:7300). Login: `admin@webshop-crm.local` / `admin12345`.
- **DEMO_MODE staat UIT** (`apps/admin/.env` → `VITE_DEMO_MODE=false`). De UI praat dus met de echte API.
- **Admin-foundation (door Atlas):**
  - `lib/api.ts` → axios-instance `api` (baseURL `/api`, cookie-auth, idempotency-interceptor). Gebruik dit.
  - `lib/shop-context.tsx` → `useActiveShop()` geeft `{ shops, activeShop, activeShopId, setActiveShop }`. **Bijna alles is shop-scoped: zet `activeShopId` in je queryKey én stuur het mee** (param `?shopId=`/`?shop=` of zoals de backend-REGISTER voorschrijft).
  - Shop-switcher staat al in de TopBar.
- **Herbruikbare UI** (`components/ui/`): `Drawer`, `Modal`, `ConfirmDialog`, `FormField`, `Toast` (+ `useToasts`), `EmptyState`, `Skeleton`, `KpiCard`, `Sparkline`, `StockBar`, `UndoSnackbar`. **Pills**: `components/orders/Pills.tsx`. Gebruik deze i.p.v. nieuwe bouwen.
- **CSS-classes** (AI Centrum-thema, in `styles.css`): `page-header`, `page-title`, `page-subtitle`, `toolbar`, `search-input`, `segmented`, `card`, `btn`/`btn-primary`/`btn-secondary`/`btn-sm`, `count-badge`, `muted`, `table`, `kpi-card`. **Gebruik bestaande classes; verzin geen nieuwe stijl.**
- **Format-helpers**: `lib/format.ts` (`formatMoney`, `formatDate`, `formatRelative`, `formatPct`).

## Gouden regels (overtreden = gebroken build)
1. **Blijf in je folder.** Schrijf alleen je eigen route-files (`apps/admin/src/routes/_app/<jouw>.tsx`) + je eigen component-subfolder (`apps/admin/src/components/<jouw-module>/`). Raak geen andere agent-pages aan.
2. **NIET `routeTree.gen.ts` editen** — die wordt door de vite-router-plugin auto-gegenereerd. Drop gewoon je route-file (`routes/_app/foo.tsx` met `export const Route = createFileRoute('/_app/foo')({...})`); Atlas regenereert + verifieert. Voor geneste routes: `routes/_app/cms.pages.tsx` → pad `/cms/pages`.
3. **NIET `components/Sidebar.tsx` editen.** Zet je gewenste sidebar-entries (label/pad/icoon) in je `REGISTER.md`; Atlas wiret de sidebar atomair.
4. **Echte data via `api` + TanStack Query.** Patroon (zie ook `routes/_app/products.tsx` + `components/product/api.ts`):
   ```ts
   import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
   import { api } from '@/lib/api';
   import { useActiveShop } from '@/lib/shop-context';
   const { activeShopId } = useActiveShop();
   const q = useQuery({
     queryKey: ['orders', activeShopId, filters],
     queryFn: async () => (await api.get('/orders', { params: { shopId: activeShopId, ...filters } })).data,
     enabled: !!activeShopId,
   });
   ```
   Mutations → `useMutation` + `qc.invalidateQueries`. Toon `Toast` op success/fout. Geld blijft string → render via `formatMoney`.
5. **Loading/empty/error**: gebruik `Skeleton`, `EmptyState`, en een nette error-card (zoals products.tsx). Geen kale spinners.
6. **Aanpasbaarheid is verplicht** (operator-eis): elke entity die je toont MOET bewerkbaar zijn via een **edit-drawer** (`components/ui/Drawer.tsx`): click-row → drawer met velden, ESC + backdrop sluit, footer Annuleer/Opslaan, delete als secundaire actie. Geen read-only lijsten.

## De bestaande preview-pages zijn je visuele basis
Veel pages bestaan al als **mock-only preview** (`routes/_app/orders.tsx`, `customers.tsx`, `suppliers.tsx`, `purchase-orders.tsx`, `finance.tsx`, `ledger.tsx`, `accounting.tsx`, `returns.tsx`). Behoud de look & feel, **vervang de mock-data door echte API-calls** (shop-scoped). Mock-imports (`lib/mock-data*`, `lib/mock-state`) eruit voor jouw pages.

## Module-toewijzing (folder-eigendom)

### Agent A — Shops-beheer (`routes/_app/shops.tsx` + `shops.$id.tsx`)
Backend: `apps/api/src/routes/shops/REGISTER.md`. NIEUWE pages: shops-lijst (kaarten/tabel met status + domein), create via drawer (slug/name/domain/locale/currency/branding-kleuren/btw-config), detail/edit met **product-publicatie-matrix** (`GET/PUT /api/shops/:id/products` — welke producten gepubliceerd, price_override, position). Sidebar-entry "Shops" (icoon `Store`) bovenaan. Components in `components/shops/`.

### Agent B — CMS-UI (`routes/_app/cms.*.tsx`)
Backend: `apps/api/src/routes/cms/REGISTER.md`. NIEUWE pages, shop-scoped via `useActiveShop`: `cms.pages.tsx` (pagina-lijst + **block-builder** drawer/editor: blocks toevoegen/sorteren/bewerken, seo-velden), `cms.blog.tsx` (blog-editor), `cms.menus.tsx` (menu + geneste items editor), `cms.media.tsx` (media-library: upload via `/api/cms/media`, grid, delete). Sidebar-sectie "Content" (Pagina's/Blog/Menu's/Media, iconen `FileText`/`Newspaper`/`Menu`/`Image`). Components in `components/cms/`.

### Agent C — Orders-UI (`routes/_app/orders.tsx` + `orders.$id.tsx`)
Backend: `apps/api/src/routes/orders/REGISTER.md`. Vervang mock door echt, shop-scoped: orders-lijst (filters status/financial/fulfillment/search + paginate, status-pills), order-detail (items met marge, klant, payments, fulfillments, returns), acties: status wijzigen, fulfilment aanmaken (location/carrier/tracking), payment, return. Edit waar zinnig via drawer/modal. Componenten in `components/orders/` (Pills.tsx bestaat al — uitbreiden mag).

### Agent D — Customers-UI (`routes/_app/customers.tsx` + `customers.$id.tsx`)
Backend: `apps/api/src/routes/customers/REGISTER.md`. Vervang mock door echt, shop-scoped: klanten-lijst (zoek op email/naam/company, B2B-badge bij vat_number), detail met adressen (CRUD via drawer) + orders-historie (`GET /api/customers/:id/orders`) + KPI's (orders_count/total_spent). Create/edit klant via drawer. Components in `components/customers/`.

### Agent E — Finance-UI (`routes/_app/finance.tsx` + `ledger.tsx` + `accounting.tsx`)
Backend: `apps/api/src/routes/finance/REGISTER.md`. Vervang mock door echt, shop-scoped waar van toepassing: `finance.tsx` = dashboards (KpiCard's omzet/marge/BTW/COGS per periode + per kanaal, Sparkline-trend, P&L-tabel via `/api/finance/pnl` + `/api/finance/ledger/aggregate`), `ledger.tsx` = grootboek-entries lijst (filters), `accounting.tsx` = exports (UBL-download, OSS-CSV-download via `/api/finance/exports/*`) + invoices-lijst. Components in `components/finance/`.

### Agent F — Inkoop-UI (`routes/_app/suppliers.tsx` + `purchase-orders.tsx`)
Backend: `apps/api/src/routes/purchasing/REGISTER.md`. Vervang mock door echt: leveranciers-lijst + create/edit-drawer, inkooporders-lijst + detail (items, status), **ontvangst-flow** (`POST /api/purchasing/po/:id/receive` — per-item ontvangen aantal, toont resulterende voorraad-mutatie). Components in `components/purchasing/`.

## REGISTER.md template (verplicht in je eerste route-folder, bv. `routes/_app/REGISTER-<module>.md`)
```md
# REGISTER — <module> UI
## Routes toegevoegd/gewijzigd
<lijst route-files + paden>
## Sidebar-entries (Atlas wiret in Sidebar.tsx)
- sectie "<Sectie>": { label, to, icon } ...
## Backend-endpoints gebruikt
<lijst>
## Backend-gaps tegengekomen (indien)
<endpoint mist X | response-shape Y onverwacht>
## Nieuwe deps
<geen | naam>
```

## Klaar =
- Pages renderen echte data (shop-scoped), met loading/empty/error + edit-drawers.
- Je eigen files zijn TypeScript-clean (geen nieuwe tsc-errors in jouw scope). Browser-verificatie (login → klikken → screenshots) doet Atlas in de finalize — jij hoeft de admin-dev-server niet te starten.
- REGISTER.md compleet. Kort eindrapport: welke routes, welke endpoints, of je tegen backend-gaps aanliep.
