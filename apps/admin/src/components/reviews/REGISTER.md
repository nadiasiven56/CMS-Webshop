# REGISTER — Reviews (/reviews) admin-UI

Wiring-instructies voor de finalizer. De feature-agent (Atlas) raakt
`Sidebar.tsx` en `routeTree.gen.ts` NIET aan — die worden hier exact beschreven.

## Nieuwe bestanden (al geschreven)

Components (`apps/admin/src/components/reviews/`):
- `api.ts` — TanStack-Query hooks + DTO's + credential/config-veld-metadata + PROVIDER_META
- `SourceStatusPill.tsx` — `SourceStatusPill` (disconnected/connected/error)
- `Stars.tsx` — `Stars` ster-weergave (fractioneel, accent-kleur)
- `SourceConfigDrawer.tsx` — credential/config-drawer per provider + Test verbinding + "Reviews ophalen" + onboarding-help

Routes (`apps/admin/src/routes/_app/`):
- `reviews.tsx` — pure layout-route (`<Outlet/>`)
- `reviews.index.tsx` — index-route (route-id `/_app/reviews/`), sources-grid + add-flow + rating-samenvatting (sterdistributie uit /summary) + recente-reviews-lijst

## 1. `apps/admin/src/components/Sidebar.tsx` — nieuwe sidebar-entry

`Star` is in Sidebar.tsx NOG NIET geïmporteerd. Voeg toe aan de lucide-react
import-lijst bovenaan:

```ts
import {
  // ... bestaande imports ...
  Star,
} from 'lucide-react';
```

Voeg een nieuwe sectie toe aan het `SECTIONS`-array. Logische plek: ná
`Verkoop` of als losse sectie. Exact:

```ts
  {
    label: 'Reputatie',
    items: [
      { label: 'Reviews', to: '/reviews', icon: Star },
    ],
  },
```

(Of voeg het item toe aan de bestaande `Verkoop`-sectie:
`{ label: 'Reviews', to: '/reviews', icon: Star },`.)

Aanbevolen icoon: **`Star`** (nieuw te importeren). Alternatief: `MessageSquare`.

## 2. `apps/admin/src/routeTree.gen.ts` — auto-regen

NIET handmatig editen. De TanStack Router vite-plugin regenereert deze file bij
`vite dev` / `tsc -b && vite build`. De route-files `reviews.tsx` +
`reviews.index.tsx` worden automatisch opgepikt (route-ids `/_app/reviews` en
`/_app/reviews/`). Tijdens dit werk is de tree al geregenereerd en bevat de
entries — bevestig na merge dat `routeTree.gen.ts` `/_app/reviews` + `/_app/reviews/` bevat.

## Geconsumeerde endpoints (`/api/reviews`, achter requireAuth)

| Methode | Pad | Hook |
| --- | --- | --- |
| GET    | `/sources` | `useReviewSources` |
| POST   | `/sources` | `useCreateSource` |
| GET    | `/sources/:id` | `useReviewSource` |
| PATCH  | `/sources/:id` | `useUpdateSource` |
| DELETE | `/sources/:id` | `useDeleteSource` |
| PUT    | `/sources/:id/credentials` | `useSetSourceCredentials` |
| POST   | `/sources/:id/test-connection` | `useTestSource` |
| POST   | `/sources/:id/fetch` | `useFetchReviews` |
| GET    | `/sources/:id/reviews` | `useSourceReviews` |
| GET    | `/summary?source_id=` | `useReviewSummary` |

Credentials per provider: kiyoh `{apiHash}`, trustpilot `{apiKey,apiSecret}`,
google `{accessToken}`. Config per provider: kiyoh `{locationId}`, trustpilot
`{businessUnitId}`, google `{accountId,locationId}`. Masked creds-map +
`hasCredentials` — raw waarden komen NOOIT terug. `ratingAverage` blijft een
STRING (numeric(3,2)); /summary geeft een number.
