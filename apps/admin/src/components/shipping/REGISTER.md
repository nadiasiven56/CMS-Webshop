# REGISTER — Verzending (/shipping) admin-UI

Wiring-instructies voor de finalizer. De feature-agent (Atlas) raakt
`Sidebar.tsx` en `routeTree.gen.ts` NIET aan — die worden hier exact beschreven.

## Nieuwe bestanden (al geschreven)

Components (`apps/admin/src/components/shipping/`):
- `api.ts` — TanStack-Query hooks + DTO's + credential-veld-metadata + CARRIER_META
- `CarrierStatusPill.tsx` — `CarrierStatusPill` (disconnected/connected/error) + `ShipmentStatusPill`
- `CarrierConfigDrawer.tsx` — credential/config-drawer per carrier-code + Test verbinding + onboarding-help

Routes (`apps/admin/src/routes/_app/`):
- `shipping.tsx` — pure layout-route (`<Outlet/>`)
- `shipping.index.tsx` — index-route (route-id `/_app/shipping/`), carriers-grid + add-flow + recente shipments-tabel met tracking

## 1. `apps/admin/src/components/Sidebar.tsx` — nieuwe sidebar-entry

NB: `Truck` is in Sidebar.tsx AL geïmporteerd (gebruikt voor "Leveranciers").
Hergebruik dezelfde import — voeg GEEN dubbele import toe. Als je een eigen icoon
wil i.p.v. te delen met Leveranciers: gebruik `PackageCheck` (lucide-react,
bestaat) en voeg die toe aan de import-lijst.

Voeg een nieuwe sectie toe aan het `SECTIONS`-array. Logische plek: direct ná de
`Operations`-sectie (waar Leveranciers/Inkoop staan), of als aparte sectie. Exact:

```ts
  {
    label: 'Fulfilment',
    items: [
      { label: 'Verzending', to: '/shipping', icon: Truck },
    ],
  },
```

(Of voeg het item toe aan de bestaande `Operations`-sectie:
`{ label: 'Verzending', to: '/shipping', icon: Truck },`.)

Aanbevolen icoon: **`Truck`** (al geïmporteerd) of **`PackageCheck`** (nieuw te
importeren).

## 2. `apps/admin/src/routeTree.gen.ts` — auto-regen

NIET handmatig editen. De TanStack Router vite-plugin regenereert deze file bij
`vite dev` / `tsc -b && vite build`. De route-files `shipping.tsx` +
`shipping.index.tsx` worden automatisch opgepikt (route-ids `/_app/shipping` en
`/_app/shipping/`). Tijdens dit werk is de tree al geregenereerd en bevat de
entries — bevestig na merge dat `routeTree.gen.ts` `/_app/shipping` + `/_app/shipping/` bevat.

## Geconsumeerde endpoints (`/api/shipping`, achter requireAuth)

| Methode | Pad | Hook |
| --- | --- | --- |
| GET    | `/carriers` | `useCarriers` |
| POST   | `/carriers` | `useCreateCarrier` |
| GET    | `/carriers/:id` | `useCarrier` |
| PATCH  | `/carriers/:id` | `useUpdateCarrier` |
| DELETE | `/carriers/:id` | `useDeleteCarrier` |
| PUT    | `/carriers/:id/credentials` | `useSetCarrierCredentials` |
| POST   | `/carriers/:id/test-connection` | `useTestCarrier` |
| GET    | `/shipments` | `useShipments` |
| GET    | `/shipments/:id/tracking` | `useShipmentTracking` |

Credentials per code: sendcloud `{publicKey,secretKey}`, myparcel `{apiKey}`,
postnl `{apiKey,customerCode,customerNumber}`, dhl (geen schema). Masked map +
`hasCredentials` — raw waarden komen NOOIT terug.
