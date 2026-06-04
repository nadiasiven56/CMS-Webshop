# REGISTER — Marketing + Statistieken (admin UI, Atlas)

Twee admin-features die op de bestaande feeds- en analytics-backends draaien:

1. **Marketing** (`/marketing`) — product-feeds (Google Shopping / Meta) +
   analytics/tracking-config per shop. Backend: `/api/feeds/*`.
2. **Statistieken** (`/analytics`) — intern BI-dashboard (omzet, best-sellers,
   kanaal/shop-verdeling, low-stock, top-klanten). Backend: `/api/analytics/*`.

Alle nieuwe files staan strikt onder:

- `apps/admin/src/components/marketing/**` (`api.ts`, deze `REGISTER.md`)
- `apps/admin/src/components/analytics/**` (`api.ts`)
- `apps/admin/src/routes/_app/marketing.tsx` + `marketing.index.tsx`
- `apps/admin/src/routes/_app/analytics.tsx` + `analytics.index.tsx`

Geen `Sidebar.tsx`, `routeTree.gen.ts` of andere features aangeraakt.

---

## 1. Sidebar-entries (finalizer — `apps/admin/src/components/Sidebar.tsx`)

De Sidebar gebruikt een `SECTIONS: NavSection[]`-array met
`{ label, to, icon }`-items (zie de bestaande secties). Voeg het volgende toe.

### a. Icon-import

`BarChart3` is **al** geïmporteerd (gebruikt door "Financieel"), dus die hoeft
NIET opnieuw. `Megaphone` is **nog niet** geïmporteerd — voeg hem toe aan de
`lucide-react`-import bovenaan:

```ts
import {
  // … bestaande imports …
  Megaphone, // ← toevoegen (BarChart3 staat er al)
} from 'lucide-react';
```

Beide namen (`Megaphone`, `BarChart3`) zijn geldige lucide-react-iconen.

### b. Twee nieuwe secties

Voeg deze twee secties toe aan de `SECTIONS`-array. Suggestie voor plaatsing:
**Marketing** vlak ná de "Kanalen"-sectie, en **Analytics** als laatste
inhoudelijke sectie (vóór "Account"), zodat "Statistieken" naast het
Dashboard-cijferwerk hangt:

```ts
{
  label: 'Marketing',
  items: [{ label: 'Marketing', to: '/marketing', icon: Megaphone }],
},
{
  label: 'Analytics',
  items: [{ label: 'Statistieken', to: '/analytics', icon: BarChart3 }],
},
```

> Alternatief: plaats `{ label: 'Statistieken', to: '/analytics', icon: BarChart3 }`
> direct ín de eerste (label-loze) sectie naast het Dashboard. Beide werken; de
> twee-secties-variant hierboven houdt de groepering consistent met de rest.

De exacte entries (zoals gevraagd):

```ts
{ label: 'Marketing',    to: '/marketing', icon: Megaphone }
{ label: 'Statistieken', to: '/analytics', icon: BarChart3 }
```

---

## 2. Route-tree (finalizer — `routeTree.gen.ts`)

De vier nieuwe route-files volgen de bestaande conventie (layout = pure
`<Outlet/>`, index-id eindigt op `/`), identiek aan `channels.tsx` /
`channels.index.tsx`:

| File                                   | `createFileRoute(...)`   | Rol                                  |
| -------------------------------------- | ------------------------ | ------------------------------------ |
| `routes/_app/marketing.tsx`            | `/_app/marketing`        | layout (Outlet)                      |
| `routes/_app/marketing.index.tsx`      | `/_app/marketing/`       | index → product-feeds + analytics    |
| `routes/_app/analytics.tsx`            | `/_app/analytics`        | layout (Outlet)                      |
| `routes/_app/analytics.index.tsx`      | `/_app/analytics/`       | index → BI-dashboard "Statistieken"  |

`routeTree.gen.ts` wordt automatisch geregenereerd door de
`TanStackRouterVite`-plugin bij de eerstvolgende `vite dev`/`build` (of
`pnpm --filter @webshop-crm/admin dev`). **Niet handmatig editen** — gewoon de
dev-server/build draaien en de plugin pikt de nieuwe files op.

> Verified: `pnpm --filter @webshop-crm/admin typecheck` compileert deze files
> zónder dat ze al in `routeTree.gen.ts` staan (zie §4) — `createFileRoute`
> accepteert het pad-literal los van de generated tree.

---

## 3. Backend-koppeling (al gemount — geen actie)

- **Marketing** consumeert `/api/feeds/*` (authed: `GET/PUT /analytics`,
  `GET/PUT /configs`, `POST /configs/:id/rebuild`). Publieke feed-URLs
  (`publicFeedUrl`) komen absoluut uit de DTO; de UI toont óók een
  `window.location.origin`-variant (zelfde pad) zodat de host met de admin-origin
  matcht.
- **Statistieken** consumeert `/api/analytics/*` (sales-over-time, top-products,
  kpis, channel-breakdown, shop-breakdown, low-stock, customers/top). Geld komt
  als **STRING** en wordt via `parseMoney` + `Intl.NumberFormat` gerenderd.

Beide backends zijn al door de orchestrator in `routes/index.ts` gemount
(`/api/feeds`, `/api/analytics`).

---

## 4. Typecheck

`pnpm --filter @webshop-crm/admin typecheck` → **0 nieuwe errors** (de 4
pre-existing baseline-errors in `ImageUploader.tsx`, `VariantForm.tsx` ×2 en
`products.new.tsx` blijven, los van deze feature).

---

## 5. Folder-eigendom (strikt)

`components/marketing/{api.ts,REGISTER.md}`,
`components/analytics/{api.ts}`,
`routes/_app/{marketing.tsx,marketing.index.tsx,analytics.tsx,analytics.index.tsx}`.

Géén `Sidebar.tsx`, `routeTree.gen.ts`, andere features of `STATUS.md`
aangeraakt — die wired de finalizer.
