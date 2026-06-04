# REGISTER — shops UI (Agent A)

Multi-shop tenant-beheer in de admin, draaiend op de **echte** `/api/shops`.
Niet shop-scoped (deze module beheert de shops zélf — geen `activeShopId` in
queryKeys).

## Routes toegevoegd/gewijzigd

| Route-file | Pad | Doel |
|---|---|---|
| `routes/_app/shops.tsx`     | `/shops`      | Lijst (cards/tabel) + status-tabs + search + "Nieuwe shop"-drawer |
| `routes/_app/shops.$id.tsx` | `/shops/:id`  | Detail/overzicht + edit-drawer + delete + **product-publicatie-matrix** |

Beide gebruiken `createFileRoute('/_app/shops')` resp. `'/_app/shops/$id'`.
> `routeTree.gen.ts` is door mij éénmalig geregenereerd (Generator-CLI) zodat
> mijn routes erin staan; Atlas regenereert finaal nadat álle Wave-2-route-files
> parsebaar zijn (zie backend-gap onder).

## Componenten (eigen folder `components/shops/`)

- `types.ts` — DTO/input-types (spiegelt backend `_serialize.ts` + `_schemas.ts`). Geld = string.
- `api.ts` — TanStack-Query hooks: `useShopList`, `useShopDetail`, `useCreateShop`,
  `useUpdateShop`, `useDeleteShop`, `useShopProducts`, `useCatalogProducts`,
  `useUpsertShopProduct`. Invalideert óók `SHOPS_QUERY_KEY` (shop-switcher in TopBar).
- `ShopDrawer.tsx` — create/edit-drawer (ESC+backdrop sluit, footer Annuleer/Opslaan,
  delete secundair in edit-modus). Velden: slug/name/domain/locale/currency/status,
  branding (primary+accent color-picker + logoUrl), btw-config (priceIncludesVat +
  oss toggle + defaultCountry). Auto-slug uit naam (create). Exporteert `valuesToPayload`.
- `ShopStatusBadge.tsx` — status-pill (active/draft/paused) op `.pill` + thema-tokens.
- `ProductPublicationMatrix.tsx` — toont ALLE catalogus-producten gemerged met
  shop-publicaties; toggle published / price_override / position via PUT.

## Sidebar-entry (Atlas wiret in `Sidebar.tsx`)

- sectie **boven Main** (bovenaan): `{ label: 'Shops', to: '/shops', icon: Store }`
  (icoon `Store` uit `lucide-react`).

## Backend-endpoints gebruikt (`apps/api/src/routes/shops/REGISTER.md`)

- `GET    /api/shops?limit&offset&status&search` → `{items,total,limit,offset}`
- `POST   /api/shops` → `201 {shop}` (409 `slug_taken`/`domain_taken` afgevangen → toast)
- `GET    /api/shops/:id` → `{shop}`
- `PATCH  /api/shops/:id` → `{shop}`
- `DELETE /api/shops/:id` → `{ok,id}`
- `GET    /api/shops/:id/products?publishedOnly` → `{shopId,items,total}`
- `PUT    /api/shops/:id/products/:productId` → `{shopProduct}` (201/200)
- `GET    /api/products?limit=200` → catalogus voor de matrix (niet-gepubliceerde producten tonen)

## Backend-gaps tegengekomen

- **Geen** ontbrekende/onverwachte endpoints in de shops-module zelf — het
  contract in `routes/shops/REGISTER.md` klopt 1-op-1 met de response-shapes.
- De matrix leunt op `GET /api/products` (Wave-1 product-module) om
  niet-gepubliceerde producten te tonen; die bestaat en levert `{items:[{id,slug,title,status,…}]}`.

## Integratie-blocker voor Atlas (niet van mij)

- `routes/_app/cms.pages.tsx` (Agent B) heeft **syntax-errors** (ongeëscapete
  apostrofs in JSX-strings, regels ~122/135/165 → `'Geen pagina's gevonden'`).
  Dit **breekt de TanStack route-generator volledig** (`generate` aborteert op de
  eerste parse-error → geen enkele route wordt geregenereerd). Atlas moet dit
  fixen vóór de finale `routeTree.gen.ts`-regeneratie, anders verschijnen géén
  Wave-2-routes (shops/cms/etc.).

## Pre-existing tsc-errors buiten mijn scope (ter info, niet door mij veroorzaakt)

- `components/ImageUploader.tsx`, `components/product/VariantForm.tsx`,
  `routes/_app/products.new.tsx` — product-module type-errors die er al stonden.

## Nieuwe deps

Geen.
