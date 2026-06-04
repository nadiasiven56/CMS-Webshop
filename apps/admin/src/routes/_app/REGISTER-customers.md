# REGISTER — customers UI (Agent D)

Admin-UI voor de echte, shop-scoped `/api/customers`. Vervangt de mock-page.

## Routes toegevoegd/gewijzigd
- `src/routes/_app/customers.tsx` — **herschreven** (mock → echte API). Klantenlijst:
  zoek (debounced, email/naam/company), B2B-badge bij `vatNumber`, paginate
  (limit/offset), klik-rij → detail, create-klant via drawer. Shop-scoped via
  `useActiveShop()` (`activeShopId` in queryKey + als `shopId`-param).
- `src/routes/_app/customers.$id.tsx` — **NIEUW**. Detailpagina:
  - KPI's (orders_count, total_spent, marketing) via `KpiCard`.
  - Klant-velden bewerkbaar via edit-drawer (`CustomerDrawer mode="edit"`).
  - Adressen-CRUD (billing/shipping + is_default) via `AddressDrawer`.
  - Orders-historie (read-only tabel, eigen paginatie).
  - Delete-klant via `ConfirmDialog` → terug naar `/customers`.

> **Atlas: regenereer `routeTree.gen.ts`.** De nieuwe route `/_app/customers/$id`
> staat nog niet in de gegenereerde tree. Vóór regen geeft tsc 1 verwachte error
> (`customers.$id.tsx(46,38): '/_app/customers/$id' is not assignable to keyof
> FileRoutesByPath`). Na het draaien van de TanStack-router-plugin (vite dev/build
> of `tsr generate`) verdwijnt die — zelfde mechaniek als `products.$id.tsx`.

## Components toegevoegd (`src/components/customers/`)
- `api.ts` — React-Query hooks + DTO-types + helpers (`customerName`, `isB2B`).
  Hooks: `useCustomerList`, `useCustomerDetail`, `useCustomerOrders`,
  `useCreateCustomer`, `useUpdateCustomer`, `useDeleteCustomer`,
  `useCreateAddress`, `useUpdateAddress`, `useDeleteAddress`.
  QueryKeys bevatten `activeShopId`/`id` voor correcte caching + invalidation.
- `CustomerDrawer.tsx` — create + edit klant (één drawer, `mode`-prop). ESC/backdrop
  sluit (via `Drawer`), footer Annuleer/Opslaan, toasts via `toastBus`,
  nette foutmeldingen (409 email_taken, 404 shop_not_found, invalid_request).
- `AddressDrawer.tsx` — create + edit adres (`mode`-prop). type-toggle
  (verzending/facturatie), ISO-2 land, is_default-checkbox.

## Sidebar-entries (Atlas wiret in Sidebar.tsx)
- Geen wijziging nodig: "Klanten" (`to: /customers`, icon `Users`) staat al in de
  sidebar (Sidebar.tsx regel ~42). Detail is een sub-route, geen eigen entry.

## Backend-endpoints gebruikt (alle onder `/api/customers`, achter requireAuth)
- `GET    /customers?shopId&search&limit&offset` — lijst (`{ items, total, limit, offset }`)
- `POST   /customers` — create (`{ customer }`, 409 email_taken, 404 shop_not_found)
- `GET    /customers/:id` — detail (`{ customer, addresses }`)
- `PATCH  /customers/:id` — update (`{ customer }`, 409 email_taken)
- `DELETE /customers/:id` — delete (`{ deleted, id }`)
- `POST   /customers/:id/addresses` — adres-create (`{ address }`)
- `PATCH  /customers/:id/addresses/:addressId` — adres-update (`{ address }`)
- `DELETE /customers/:id/addresses/:addressId` — adres-delete (`{ deleted, id }`)
- `GET    /customers/:id/orders?limit&offset` — read-only order-historie (`{ items, total, limit, offset }`)

Adressen worden uit de detail-response (`GET /:id` → `addresses`) gerenderd; na
adres-mutaties wordt de detail-query geïnvalideerd (geen aparte
`GET /:id/addresses`-call nodig, maar het endpoint bestaat).

## Backend-gaps tegengekomen
- Geen. Alle benodigde endpoints + response-shapes uit
  `routes/customers/REGISTER.md` bestaan en sluiten aan.
- Opmerking (geen actie): `ordersCount` / `totalSpent` zijn read-only denormalized
  aggregaten — de UI toont ze als KPI maar muteert ze niet (conform contract; die
  worden door de orders-feature bijgewerkt).

## Nieuwe deps
- Geen. (axios `api`, `@tanstack/react-query`, `lucide-react`, bestaande UI-components.)
