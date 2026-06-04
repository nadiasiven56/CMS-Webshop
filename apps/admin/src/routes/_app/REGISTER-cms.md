# REGISTER — CMS-UI (Agent B)

Admin-UI voor de CMS-module (Content). Alle pages shop-scoped via `useActiveShop()`
(`activeShopId` in elke queryKey + als `?shop=` param; bij writes ook `shopId` in body).

## Routes toegevoegd

| Route-file | Pad | Inhoud |
|---|---|---|
| `routes/_app/cms.pages.tsx` | `/cms/pages` | Pagina-lijst (status-tabs + zoek) + edit-drawer met **block-builder** + SEO |
| `routes/_app/cms.blog.tsx` | `/cms/blog` | Blog-posts lijst + editor (title/slug/excerpt/body_html/cover/author/tags/status/seo) |
| `routes/_app/cms.menus.tsx` | `/cms/menus` | Menu-kaarten + edit-drawer met geneste items-editor (label/url/parent, sorteerbaar) |
| `routes/_app/cms.media.tsx` | `/cms/media` | Media-library grid + uploader + edit-drawer (alt/folder) + delete |

> **Atlas:** `routeTree.gen.ts` regenereren (vite-router-plugin). Tot dan geven de 4
> `createFileRoute('/_app/cms/...')` calls een TS2345 (`not assignable to keyof
> FileRoutesByPath`) — dat is puur de ontbrekende route-registratie, geen code-bug.
> Na regen verdwijnen ze.

## Components toegevoegd (`components/cms/`)

- `types.ts` — CMS-DTO's (gespiegeld aan `api/.../cms/_serialize.ts`)
- `api.ts` — TanStack Query hooks (pages/blog/menus/media), shop-scoped
- `pills.tsx` — `PageStatusPill` / `BlogStatusPill` / `BlockTypePill` + `BLOCK_META` + `slugifyPreview`
- `BlockBuilder.tsx` — geordende block-editor (hero/richtext/banner/product-grid/html), sorteren/dupliceren/verwijderen
- `SeoFieldset.tsx` — herbruikbare SEO-velden (title/description/ogImage/noindex)
- `MenuItemsEditor.tsx` — platte sorteerbare items-lijst met 1 nesting-niveau (ref/parentRef → bulk-PUT)
- `MediaUploader.tsx` — multipart-uploader naar `/api/cms/media`

## Sidebar-entries (Atlas wiret in `Sidebar.tsx`)

Nieuwe sectie **"Content"** (lucide-iconen):

- `{ label: "Pagina's", to: "/cms/pages",  icon: FileText }`
- `{ label: "Blog",      to: "/cms/blog",   icon: Newspaper }`
- `{ label: "Menu's",    to: "/cms/menus",  icon: Menu }`
- `{ label: "Media",     to: "/cms/media",  icon: Image }`  *(lucide-export heet `ImageIcon`)*

## Backend-endpoints gebruikt

- **Pages**: `GET/POST /api/cms/pages`, `PATCH/DELETE /api/cms/pages/:id`
- **Blog**: `GET/POST /api/cms/blog`, `PATCH/DELETE /api/cms/blog/:id`
- **Menus**: `GET /api/cms/menus`, `GET /api/cms/menus/:id` (geneste items), `POST /api/cms/menus`,
  `PATCH/DELETE /api/cms/menus/:id`, `PUT /api/cms/menus/:id/items` (bulk-replace, nesting via `ref`/`parentRef`)
- **Media**: `GET /api/cms/media` (`scope=all`), `POST /api/cms/media` (multipart),
  `PATCH/DELETE /api/cms/media/:id`

Response-shapes: list = `{ items, total, limit, offset }`; single = `{ page }` / `{ post }` /
`{ menu }` / `{ media }`; menu-items PUT → `{ items }` (geneste boom).

## Backend-gaps tegengekomen

Geen. Het CMS-contract dekt alle UI-behoeften. Twee bewuste keuzes aan UI-kant:

1. **Blocks** worden als `{ id, type, data }`-objecten in de jsonb-array bewaard (`id` is
   client-only voor stabiele keys; de backend slaat de array vorm-vrij 1-op-1 op). Geen
   diepe per-block validatie (matcht de "vorm-vrij V1"-keuze in de backend-REGISTER).
2. **Menu-items**: de backend ondersteunt diepe nesting; de UI-editor exposeert 1
   nesting-niveau (root + sub) via de bulk-PUT (`ref`/`parentRef`), wat de meeste
   shop-navigaties dekt. Diepere nesting kan later toegevoegd worden zonder API-wijziging.

## Nieuwe deps

Geen. Alleen bestaande: `@tanstack/react-query`, `@tanstack/react-router`, `lucide-react`,
`@/lib/api`, `@/lib/shop-context`, `@/lib/format`, `@/lib/toast`, `components/ui/*`.

## Toasts / aanpasbaarheid

Alle entities zijn bewerkbaar via edit-drawer (ESC + backdrop sluit, footer Annuleer/Opslaan,
delete als secundaire `btn-danger` met `ConfirmDialog`). Success/fout → `toast` (globale
`ToastContainer` zit al in `_app.tsx`). Loading = `Skeleton`, leeg = `EmptyState`, error = error-card.
