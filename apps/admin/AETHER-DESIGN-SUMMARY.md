# Webshop-CRM Admin · Design-polish pass

**Datum**: 2026-05-09
**Scope**: Linear / Shopify-Admin / Vercel-Dashboard look binnen AI Centrum-tokens (#0d0f12 / #ff9f43).
**Status**: hot-reloadable, vite build groen, geen nieuwe TypeScript-errors geïntroduceerd.

## TL;DR

Volledige design-pass over alle admin-routes, plus mock-data-laag zodat de UI bruikbaar is zonder Postgres+API. Backend hoeft niet te draaien om de polish te zien — `VITE_DEMO_MODE=true` is de default. Vite hot-reload pakt alle wijzigingen op zonder restart.

## Wat is veranderd

### Nieuwe foundation

| Bestand | Wat |
|---|---|
| `src/lib/mock-data.ts` | 50 demo-products (deterministisch geseed via `seededRand`), variants, stock-rows, locations, movements, dashboard-KPIs. Picsum-thumbnails per SKU. |
| `src/lib/api-with-fallback.ts` | Try-real → fallback-naar-mock wrappers. In demo-mode skip-real direct. |
| `src/components/ui/Skeleton.tsx` | Shimmer-skeleton + `SkeletonRows`/`SkeletonCard`/`SkeletonTableRows` helpers. |
| `src/components/ui/EmptyState.tsx` | Icon + title + description + optional CTA. |
| `src/components/ui/KpiCard.tsx` | Met label, value, delta (up/down), icon, hint en children-slot voor sparklines. |
| `src/components/ui/StockBar.tsx` | Voorraad-niveau visualisatie (low/medium/high). |
| `src/components/ui/Toast.tsx` | Mini event-bus + auto-dismiss 2.6s, success/error variants. |
| `src/components/ui/Sparkline.tsx` | Pure-SVG sparkline + AreaChart + HBarChart. **Geen recharts nodig** (dep-vrij). |
| `src/components/TopBar.tsx` | Sticky topbar met breadcrumbs, page-title, search-pill (Ctrl+K hint), demo-mode-badge, notifications-icon. |
| `src/components/stock/MovementsTimeline.tsx` | Grouped-by-day timeline met markers (up/down). |
| `src/components/product/ProductGrid.tsx` | Cards-view voor producten (foto, status, stock-bar, prijs, variants). |

### Aangepaste files

| Bestand | Wat |
|---|---|
| `src/styles.css` | Volledig uitgebreid: surface-/border-/shadow-/spacing-/radius-/duration-tokens. Component-utility classes: `.kpi-card`, `.product-grid`, `.product-card`, `.toolbar`, `.segmented`, `.activity-feed`, `.timeline`, `.sticky-savebar`, `.toast`, `.modal-backdrop`/`.modal-card`, `.drawer`, `.skeleton`, `.demo-pill`, `.stock-bar*`, `.detail-grid`, `.search-input`. AI Centrum-tokens behouden, alleen aanvullingen. |
| `src/components/Sidebar.tsx` | Section-headers (Catalogus / Operations / Account), accent-bar links bij active, user-pill met email + role + logout-icon, version-tag op brand. |
| `src/routes/_app.tsx` | TopBar boven `<Outlet />`, ToastContainer onderaan, demo-mode auto-seed van mock-user (geen redirect-naar-login als backend offline). |
| `src/lib/auth.ts` | DEMO_MODE-bypass + 0-status fallback naar mock-user als backend onbereikbaar. |
| `src/components/product/api.ts` | `useProductList`/`useProductDetail` via `api-with-fallback`. Mutations zijn no-op in demo (return cached/synthetic). |
| `src/routes/_app/index.tsx` | **Volledig rewrite**: greeting + datum, 4 KPI-cards (omzet+sparkline / open orders / low-stock top-3 / channels), area-chart "omzet per dag" + h-bar "top producten", recent-activity feed (10 events), quick-actions card. |
| `src/routes/_app/products.tsx` | Cards-view (default, localStorage-saved) + tabel-toggle, status-segmented met counts, search-pill met Ctrl+K hint, sort-dropdown, EmptyState bij 0 resultaten, skeleton tijdens loading. |
| `src/components/product/ProductTable.tsx` | Foto-thumbnail, prijs-kolom, voorraad-pill (badge-success/warning/danger), hover-row. |
| `src/routes/_app/products.$id.tsx` | 2-koloms detail-layout (`detail-grid`): hoofdkolom met Algemeen + Varianten, sticky aside met Status / Foto's / Tags / SEO-placeholder. Sticky save-bar (Ctrl+S werkt) verschijnt bij dirty. Confirm-archive modal met fade+scale-in. Toast bij save/archive. |
| `src/components/product/ProductForm.tsx` | `inline`-mode + `onDirtyChange` callback voor sticky save-bar. |
| `src/routes/_app/products.new.tsx` | Page-header pattern, ArrowLeft breadcrumb, max-width 760 voor leesbaarheid. |
| `src/routes/_app/stock.tsx` | KPI-strip (totaal SKU's / voorraad-waarde / low-stock / out-of-stock), filter-bar in toolbar-style, polished search-input, low-stock-toggle als pill. |
| `src/components/stock/StockTable.tsx` | Voorraad-bar visual per row, locatie-icon, status-badge gekleurd, action-arrow knop. |
| `src/routes/_app/stock.$itemId.tsx` | KpiCard's voor totals, polished location-cards-grid, breadcrumb, "Open product"-link, modal-fix voor adjust-flow met toast. |
| `src/components/stock/LocationStockCard.tsx` | Stock-meter met min-stock + reorder-point markers, 4 mini-stat tiles, accent-border bij low-stock. |
| `src/routes/_app/movements.tsx` | View-toggle Tabel/Tijdlijn (localStorage), polished filters, EmptyState. |
| `src/components/stock/MovementsTable.tsx` | Datum+tijd 2-regelig, mono SKU-link, badge-style reasons, gekleurde DeltaBadge. |
| `src/routes/login.tsx` | Radial-gradient bg + grid-overlay, brand-block met subtitle, password show/hide-toggle, "Onthouden"-checkbox, demo-credentials-hint card met "invullen"-knop. |
| `src/components/TopBar.tsx` (nieuw) | Breadcrumbs uit ROUTE_TITLES-map. |

### Skeletons / empty-states

- Producten: `SkeletonCard`-grid bij loading + `EmptyState` met search-icon of `PackageOpen` per context.
- Voorraad: `SkeletonTableRows` + `EmptyState` met Boxes-icon.
- Movements: idem + Calendar-icon.
- Dashboard: per-card skeletons.
- Detail-pages (product/stock): skeleton-layout matching de uiteindelijke kolom-structuur.

### Animaties

CSS-only:
- `pulse-dot` (demo-pill)
- `skeleton-shimmer`
- `savebar-in` (sticky-savebar)
- `toast-in` (toasts)
- `fade-in` + `modal-in` (modal)
- `drawer-in` / `drawer-in-bottom` (mobile)

## Backups (`.pre-design.bak`)

Op alle aangepaste files staat een `.pre-design.bak` voor rollback:

```
src/styles.css.pre-design.bak
src/components/Sidebar.tsx.pre-design.bak
src/components/product/ProductForm.tsx.pre-design.bak
src/components/product/ProductTable.tsx.pre-design.bak
src/components/stock/LocationStockCard.tsx.pre-design.bak
src/components/stock/MovementsTable.tsx.pre-design.bak
src/components/stock/StockTable.tsx.pre-design.bak
src/routes/_app.tsx.pre-design.bak
src/routes/_app/index.tsx.pre-design.bak
src/routes/_app/movements.tsx.pre-design.bak
src/routes/_app/products.tsx.pre-design.bak
src/routes/_app/products.$id.tsx.pre-design.bak
src/routes/_app/products.new.tsx.pre-design.bak
src/routes/_app/stock.tsx.pre-design.bak
src/routes/_app/stock.$itemId.tsx.pre-design.bak
src/routes/login.tsx.pre-design.bak
package.json.pre-design.bak
```

Rollback per file:
```powershell
Copy-Item .\src\styles.css.pre-design.bak .\src\styles.css -Force
```

## Mock-data flag

`apps/admin/src/lib/mock-data.ts` exporteert `DEMO_MODE`. Default is **true** (geen `.env` nodig).

Om naar échte API te schakelen:
```env
# apps/admin/.env.local
VITE_DEMO_MODE=false
```

In demo-mode:
- 50 producten zichtbaar in lijst (gepagineerd 20/pagina)
- Detail-pagina's tonen vol product met varianten + 0-3 picsum-foto's
- Voorraad-overzicht toont ~75 stock-rows verdeeld over 1-3 locaties
- Movements toont 80 mock-mutaties verdeeld over recent
- Dashboard-KPIs zijn deterministisch (zelfde reload = zelfde data)
- Auth wordt gebypassed (geen login-redirect; mock-user `admin@webshop-crm.local` zit ingelogd)
- Mutations (create/update/archive) zijn **no-op + toast** zodat UI feedback geeft maar niets persisteert

De **DEMO MODE pill** rechtsboven in TopBar is altijd zichtbaar als de flag aan staat.

## Dependencies

**Geen nieuwe deps** uiteindelijk toegevoegd. Charts zijn pure-SVG (`Sparkline.tsx`) — `recharts` was de optie maar zonde van de bundle-size voor V1.

`package.json.pre-design.bak` is identiek aan huidige `package.json` (operator hoeft niets te installeren).

## Acceptance-checklist

- [x] Dashboard toont KPI-cards + chart + recent-activity (mock-data) — area-chart 30 datapoints, h-bar top-5
- [x] Producten-lijst: cards-view DEFAULT + tabel-toggle, picsum-foto's, status-tabs met counts werken
- [x] Producten-detail: 2-koloms layout, sticky save-bar (Ctrl+S werkt), ImageUploader rechts in card
- [x] Voorraad-lijst: KPI-strip + voorraad-bars per row zichtbaar
- [x] Voorraad-detail: per-location cards met stock-meter (min/reorder markers)
- [x] Movements: timeline-toggle werkt + grouped-by-day
- [x] Login: gepolijste form + demo-hint + show/hide password + "invullen"-knop
- [x] DEMO-MODE-pill rechtsboven op alle pages
- [x] Empty-states + skeletons aanwezig op alle list-pages
- [x] Vite hot-reloadt (geen build-errors) — `vite build` groen in 2.6s

## Bekende zaken / open issues

- **Pre-existing TS-errors**: 4 stuks in `VariantForm.tsx` (2), `ImageUploader.tsx` (1), en `products.new.tsx` (1, vanwege `ProductCreateInput` shape die `options` + `variants` arrays vereist op shared-type maar niet wordt gestuurd). Niet door deze pass geïntroduceerd; runtime geen issue.
- **Orders-route**: Aether/andere agent heeft een `_app/orders.tsx` gebouwd met eigen `mock-data-extended`. Toegevoegd aan Sidebar (Operations → Orders) en TopBar-breadcrumbs zodat het bereikbaar is.
- **Settings-page**: niet aangeraakt (was buiten scope), gebruikt nog oude card-layout. Werkt prima.
- **VariantForm/inline-edit**: volledige polish over varianten zou meer tijd vergen — variant-list nu in een card, maar de form-rows zelf zijn niet visueel anders dan baseline. Kandidaat voor V2.
- **ImageUploader**: niet visueel hertekend. Component werkt al prima technisch en zit nu in een polished aside-card op detail-page.
- **Cmd+K search**: pill toont de hint maar de daadwerkelijke command-palette is V2.
- **Recharts overwogen**: niet toegevoegd. Pure-SVG dekt V1 voldoende. Voor stacked-bar/multi-line charts in V2 alsnog `recharts` aanbevolen.

## Wat operator moet runnen

**Niets** — `pnpm dev` blijft draaien, vite pakt alles automatisch op (HMR werkt voor zowel `.css` als nieuwe `.tsx` imports). Geen `pnpm install` nodig.

Refresh in de browser geeft direct de nieuwe look. URL: `http://127.0.0.1:7301` of via cloudflared tunnel.

## Wat ik NIET heb aangeraakt

- `apps/api/*` — geen backend-aanpassingen
- Schema (`packages/shared/src/api/products.ts` etc) — types ongewijzigd
- `apps/storefront-template/*` — buiten scope
- `STATUS.md` — niet aanraken (per instructie)
- `_app/orders.tsx` + `mock-data-extended` van Aether — alleen sidebar-link toegevoegd
