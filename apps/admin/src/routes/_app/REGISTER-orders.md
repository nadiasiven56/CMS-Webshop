# REGISTER — orders UI (Agent C)

Vervangt de mock-only orders-preview door echte, shop-scoped `/api/orders`.

## Routes toegevoegd/gewijzigd
- `routes/_app/orders.tsx` — orders-lijst (echte API). Path `/orders`.
- `routes/_app/orders.$id.tsx` — order-detail (echte API). Path `/orders/$id`
  (**param `id` = order-UUID**, niet meer `order_number`). Klik-rij in de lijst
  navigeert nu met `o.id`.

## Components (folder-eigendom `components/orders/`)
- `Pills.tsx` — herschreven naar de ECHTE backend-statuswaarden. Nieuwe exports:
  `OrderStatusPill`, `FinancialStatusPill`, `FulfillmentStatusPill`,
  `ReturnStatusPill`, `PaymentStatusPill`, `ChannelPill`. `ChannelStatusPill`
  bleef behouden (wordt geïmporteerd door `routes/_app/channels.tsx` — niet mijn
  scope, daarom backwards-compat gehouden).
- `api.ts` — DTO-types + React-Query hooks (`useOrderList`, `useOrderDetail`,
  `useCreateOrder`, `useUpdateOrderStatus`, `useCreateFulfillment`,
  `useCreatePayment`, `useCreateReturn`, `useCustomerOptions`). QueryKeys
  bevatten `activeShopId`.
- `money.ts` — helper: backend geeft bedragen als **string**; `money()` parset
  veilig en rendert via `lib/format.formatMoney`. `marginPct()` voor percentages.
- `CreateOrderDrawer.tsx` — handmatige order via `POST /api/orders` (multi-line,
  optionele klant uit `/api/customers`, verzend/korting, notitie).
- `OrderActionModals.tsx` — `StatusModal`, `FulfillmentModal`, `PaymentModal`,
  `ReturnModal` (+ `allowedStatuses()` helper die de state-machine spiegelt).

## Sidebar-entries (Atlas wiret in Sidebar.tsx)
- Geen wijziging nodig. "Orders" staat al in de sidebar en wijst naar `/orders`.
  De detail-route `/orders/$id` is geen sidebar-item.

## Backend-endpoints gebruikt
- `GET  /api/orders?shop_id&status&financial_status&fulfillment_status&channel&search&limit&offset`
  → `{ items: [...orderCore, itemCount, customerName], total, limit, offset }`.
  **Query-params zijn snake_case** (`shop_id`, `financial_status`, …).
- `GET  /api/orders/:id` (`:id` = UUID) → `{ order: {...core, customer, items[],
  payments[], fulfillments[], returns[], margin, marginPct} }`.
- `PATCH /api/orders/:id/status` body `{status, note?}`.
- `POST /api/orders/:id/fulfillments` body `{locationId?, carrier?, trackingCode?, trackingUrl?, status?}`.
- `POST /api/orders/:id/payments` body `{provider?, amount, status?, reference?}`.
- `POST /api/orders/:id/returns` body `{reason?, refundAmount?, status?, items[]}`.
- `GET  /api/customers?shopId&search&limit` (Agent D's module) — alleen voor de
  klant-picker in de create-drawer. **Let op: deze gebruikt `shopId` (camelCase)**,
  terwijl orders `shop_id` (snake_case) gebruikt. Beide zijn correct t.o.v. hun
  eigen backend-schema; niet "fixen".

## Backend-gaps tegengekomen
1. **Geen `GET /api/locations`.** De fulfilment-modal heeft daardoor geen
   locatie-keuzelijst; `locationId` is een optioneel vrij UUID-tekstveld (mag leeg).
   Zelfde gap staat ook in `routes/stock/STOCK-AGENT-SUMMARY.md` genoteerd. Zodra
   er een locaties-endpoint is → vervang het tekstveld door een `<select>`.
2. **Detail-navigatie is op UUID, niet op order_number.** `GET /api/orders/:id`
   valideert strikt op UUID (`isUuid`). Order-nummers (bv. `CR-1001`) werken dus
   niet als route-param. De lijst toont het order_number als label maar navigeert
   met de UUID. Geen lookup-by-number-endpoint aanwezig.
3. **Geen status-historie / timeline-endpoint.** De oude mock had een event-tijdlijn;
   die is verwijderd omdat er geen audit-/events-leesendpoint is (audit-rows worden
   wel geschreven maar niet via de orders-API teruggelezen). Payments/fulfillments/
   returns dienen als de facto activiteitenlijst.
4. **Klant-profiel-link** wijst naar `/customers/:id` via een plain `<a>` (geen
   TanStack `Link`) zodat dit niet afhangt van de nog-niet-gegenereerde route-tree
   van Agent D. Atlas kan dit desgewenst omzetten naar een typed `Link` zodra
   `customers.$id` in `routeTree.gen.ts` staat.

## Nieuwe deps
Geen.

## tsc-status
`pnpm --filter @webshop-crm/admin exec tsc --noEmit` → **0 errors in Agent-C scope**
(`routes/_app/orders*.tsx` + `components/orders/*`). De overige tsc-fouten in de
build komen uit de **stale `routeTree.gen.ts`** (mist nog de nieuwe Wave-2 routes
van shops/customers/cms) — die lost de regeneratie door Atlas op. Niet mijn files.
