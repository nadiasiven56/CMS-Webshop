# REGISTER — Inkoop-UI (Agent F — purchasing)

Echte-data admin-pages voor leveranciers + inkooporders, draaiend op
`/api/purchasing/*`. Mock-imports (`mock-data-extended`, `mock-state`) zijn
volledig verwijderd. Purchasing is **niet shop-scoped** (de backend-routes
kennen geen `shopId`), dus `useActiveShop` wordt hier bewust niet gebruikt.

## Routes toegevoegd/gewijzigd
- `routes/_app/suppliers.tsx` — herschreven: leveranciers-lijst (cards) + zoek +
  actief-filter, click-card → edit-drawer, create-drawer, deactiveren via confirm.
- `routes/_app/purchase-orders.tsx` — herschreven: PO-lijst (status-pills,
  KPI's, status-tabs, leverancier-filter), click-row → detail/ontvangst-drawer,
  create-PO-drawer.

## Components toegevoegd (`components/purchasing/`)
- `api.ts` — TanStack-Query hooks + DTO-types (suppliers CRUD, PO CRUD,
  receive, catalog-search via `/stock`).
- `SupplierDrawer.tsx` — create/edit leverancier (naam/email/phone/adres/
  lead-time/currency/notes/active) + delete-knop.
- `PoCreateDrawer.tsx` — nieuwe PO: leverancier + regels (catalog-picker op
  `variantId` of vrije SKU-regel) + aantal/inkoopprijs + BTW% + verwacht-datum.
- `PoDetailDrawer.tsx` — PO-detail (items, totalen, status), status-acties
  (markeer besteld / annuleer / verwijder) en **ontvangst-flow** (per-item
  aantal → `POST /po/:id/receive`, toont resulterende voorraad `newOnHand`).
- `poStatus.tsx` — status-pill + status-tabs helper (draft/ordered/partial/
  received/cancelled).

## Sidebar-entries (Atlas wiret in Sidebar.tsx)
Beide stonden al in de sidebar (geen wijziging nodig). Gewenste plaatsing —
sectie "Inkoop":
- `{ label: 'Leveranciers', to: '/suppliers', icon: 'Truck' }`
- `{ label: 'Inkooporders', to: '/purchase-orders', icon: 'FileText' }`

## Backend-endpoints gebruikt
- `GET    /api/purchasing/suppliers` (limit/offset/search/active)
- `POST   /api/purchasing/suppliers`
- `PATCH  /api/purchasing/suppliers/:id`
- `DELETE /api/purchasing/suppliers/:id` (soft-delete; `?hard=true` ongebruikt)
- `GET    /api/purchasing/po` (limit/offset/status/supplierId, incl. itemCount)
- `POST   /api/purchasing/po` (items[] + taxRate)
- `GET    /api/purchasing/po/:id` (items met quantityOutstanding + lineTotal)
- `PATCH  /api/purchasing/po/:id` (status-transitie)
- `DELETE /api/purchasing/po/:id` (alleen draft/cancelled)
- `POST   /api/purchasing/po/:id/receive` (lines[{itemId,quantity}], optionele locationId/note)
- `GET    /api/stock` — hergebruikt als variant-zoeker voor PO-regels
  (levert itemId/sku/variantId/variantSku/productTitle).

## Backend-gaps tegengekomen
1. **Geen `GET /api/locations`-endpoint.** De receive-flow leunt daarom op
   `po.location_id` (backend-fallback). Als een PO geen locatie heeft geeft
   receive `422 location_required`; de drawer vangt dat af en toont dan een
   handmatig **locatie-ID (UUID) invoerveld**. Een locations-list-endpoint zou
   dit veel gebruiksvriendelijker maken (dropdown i.p.v. UUID typen) — ook
   nuttig om een locatie te kiezen bij PO-create. (Reeds gesignaleerd in
   `routes/stock/STOCK-AGENT-SUMMARY.md`.)
2. **Geen variant-search-endpoint.** PO-regels worden samengesteld via de
   `/stock`-overview als catalog-picker. Items zonder gekoppelde variant kunnen
   niet als stock-regel worden besteld (alleen als vrije SKU-regel zonder
   voorraad-effect). Een dedicated `GET /api/variants?search=` zou cleaner zijn.
3. `purchase_order_items` heeft geen per-regel BTW; BTW is een PO-breed
   `taxRate`-percentage (zoals door de backend bedoeld). UI volgt dat.

## Nieuwe deps
Geen.
