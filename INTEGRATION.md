# INTEGRATION.md — Contract voor parallelle feature-agents

**Doel**: 3 feature-agents (product / stock / image) bouwen Fase 1 ronde 2
parallel zonder elkaars bestanden te raken. Deze file legt vast wie welke
folder bezit, hoe ze elkaar's spullen mogen importeren, en hoe ze hun route
in de API/admin registreren.

**Owner van deze file**: Atlas. Feature-agents wijzigen deze file NIET.

## Algemene regels (ALLE agents)

1. Werk uitsluitend in je eigen folders (zie tabel hieronder). Touch nooit
   een andere agent's folder.
2. **Bestaande shared modules** mag je vrijelijk **importeren** — nooit
   editen. Concreet:
   - `apps/api/src/lib/*` (db, env, logger, auth)
   - `apps/api/src/middleware/*` (requireAuth, idempotency)
   - `apps/api/src/db/schema/*.ts` (V1 foundation-tabellen, al gemaakt)
   - `packages/shared/src/*` (types, zod-schemas)
3. **Schema-files toevoegen mag**: leg je tabel in
   `apps/api/src/db/schema/<jouw-tabel>.ts` en re-export in
   `apps/api/src/db/schema/index.ts` op een **NIEUW regel** (geen merge-
   conflict op bestaande exports). Daarna run je
   `pnpm --filter @webshop-crm/api db:generate` om een additieve migration
   te creeren. NOOIT bestaande migrations editen.
4. **Route-registratie**: voeg precies 1 regel toe aan
   `apps/api/src/routes/index.ts` op de gemarkeerde slot:
   ```ts
   apiRoutes.route('/products', productRoutes);
   ```
   Maak je import-regel een aparte regel zodat git-diff helder is.
5. **Admin nav**: zit al in `apps/admin/src/components/Sidebar.tsx`. Wijzig
   die file NIET — je vervangt alleen de inhoud van je placeholder-route.
6. **Auth**: alle write-endpoints moeten achter `requireAuth` middleware. De
   placeholder-route in admin gebruikt `_app` pathless layout die guard al doet.
7. **Idempotency**: de `idempotency`-middleware staat al global op `/api/*`,
   geen extra werk nodig. Stuur 'Idempotency-Key' header bij POST/PUT/PATCH/
   DELETE als de operatie kosten heeft (DB-write, externe call).
8. **Money**: gebruik `@webshop-crm/shared/types/money` — NOOIT raw
   `number` voor bedragen. Postgres geeft `numeric(12,4)` terug als string.
9. **Geld-precisie + audit**: bij elke schrijf-operatie op orders / stock
   / financial moet er een `audit_log`-row geschreven worden (gebruik
   helper die je zelf bouwt of die finalizer levert in pass 3).
10. **Tests**: minstens 1 vitest-unit test per route + 1 happy-path test in
    je admin-page. Test files naast de source: `*.test.ts(x)`.

## Folder-eigendom per agent

### product-agent

**Schaal**: product-CRUD + variant-CRUD + option-types beheren.

| Eigendom (mag schrijven) | Type |
|---|---|
| `apps/api/src/routes/products/**` | Hono-router voor /api/products |
| `apps/admin/src/routes/_app/products.tsx` | overschrijven (vervang placeholder) |
| `apps/admin/src/routes/_app/products.*.tsx` | sub-routes (`products.$id.tsx` etc) |
| `apps/admin/src/components/product/**` | components specifiek voor producten |
| `packages/shared/src/api/products.ts` | uitbreiden (mag — placeholder) |
| `apps/api/src/domain/products/**` | business-logic (slug-generation, etc) |

**Mag NIET** schrijven:
- `apps/api/src/db/schema/products.ts` — al gemaakt door Atlas (foundation).
- `apps/api/src/db/schema/variants.ts` — al gemaakt.
- Andere agents' folders.

**Toegestaan om uit te breiden**:
- Voeg `apps/api/src/db/schema/product-categories.ts` toe als je categories nodig hebt.
- Voeg `apps/api/src/db/schema/product-translations.ts` toe als V1 i18n nodig blijkt.

**Endpoints om te bouwen** (minimaal):
- `GET    /api/products` — paginate + filter (status/search)
- `POST   /api/products` — create (incl varianten)
- `GET    /api/products/:id`
- `PATCH  /api/products/:id`
- `DELETE /api/products/:id`
- `POST   /api/products/:id/variants` — add variant
- `PATCH  /api/products/:id/variants/:variantId`
- `DELETE /api/products/:id/variants/:variantId`

---

### stock-agent

**Scope**: voorraad per locatie tonen, handmatige adjustments doen,
movements-log read-only weergeven, reservations zichtbaar maken.

| Eigendom (mag schrijven) | Type |
|---|---|
| `apps/api/src/routes/stock/**` | Hono-router voor /api/stock |
| `apps/api/src/routes/movements/**` | Hono-router voor /api/movements |
| `apps/admin/src/routes/_app/stock.tsx` | overschrijven (vervang placeholder) |
| `apps/admin/src/routes/_app/movements.tsx` | overschrijven (vervang placeholder) |
| `apps/admin/src/components/stock/**` | stock-specifieke components |
| `apps/api/src/domain/stock/**` | business-logic (allocator-helper, available-recompute) |

**Mag NIET** schrijven:
- Schema-files voor inventory_* (al gemaakt door Atlas).
- Product-routes of andere agents' folders.

**Toegestaan**:
- Eigen schema's voor `stock_adjustments` als je een aparte tabel wilt
  voor handmatige aanpassingen (i.p.v. via `inventory_movements`).

**Endpoints om te bouwen** (minimaal):
- `GET    /api/stock` — overview per item per location
- `GET    /api/stock/:itemId` — detail met levels per location
- `POST   /api/stock/:itemId/adjust` — handmatige adjust (delta + reason)
- `GET    /api/movements` — paginated read-only history (filter op item/datum/reason)

**Constraint die je MOET respecteren**: bij elke positieve/negatieve
adjustment moet je
1. `inventory_levels.on_hand` updaten,
2. `inventory_movements` row schrijven met user-id als `actor_id`,
3. `inventory_levels.available = on_hand - committed` consistent houden.

Doe dit in een Drizzle-transaction.

---

### image-agent

**Scope**: image-upload-component voor admin. Backend-route ontvangt
multipart-upload, slaat lokaal op (`./storage/images/<productId>/<uuid>.<ext>`),
return URL. Voorbij V1 wisselen we naar S3 — daarom storage-driver-abstractie.

| Eigendom (mag schrijven) | Type |
|---|---|
| `apps/api/src/routes/images/**` | Hono-router voor /api/images |
| `apps/api/src/lib/storage/**` | storage-driver abstractie (local + s3-stub) |
| `apps/admin/src/components/ImageUploader.tsx` | drag-drop component |
| `apps/admin/src/components/image/**` | image-specifieke sub-components |
| `apps/api/src/domain/images/**` | image-resize/optimize logic indien nodig |

**Mag NIET** schrijven:
- `apps/api/src/db/schema/product-images.ts` — al gemaakt door Atlas.
- Product-routes / stock-routes.

**Endpoints om te bouwen** (minimaal):
- `POST   /api/images` — multipart-upload, return `{ id, url, alt? }`
- `DELETE /api/images/:id` — verwijder file van disk + DB-row

**Constraint**:
- Sla files NOOIT in repo op (`storage/` staat in `.gitignore`).
- Gebruik `STORAGE_LOCAL_PATH` uit env (default `./storage`).
- Filenames: `<uuid>-<originalname>.<ext>` om collisions te voorkomen.

---

## Hoe import-paden werken

```ts
// In apps/api/src/routes/products/index.ts
import { db } from '../../lib/db.js';
import { requireAuth } from '../../middleware/auth.js';
import { products, variants } from '../../db/schema/index.js';
import { Money } from '@webshop-crm/shared';
```

```tsx
// In apps/admin/src/routes/_app/products.tsx
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Products } from '@webshop-crm/shared';
```

`@webshop-crm/shared` resolve via pnpm-workspace. Het sluit dus aan zonder
extra build-step (workspaces hebben TS-source als entry).

## Test-eisen per agent

| Test-type | Wat | Tool |
|---|---|---|
| API unit | Per route 1 happy + 1 error case | vitest in `apps/api/src/routes/<feature>/__tests__/` |
| API integration (optioneel V1) | Echte Postgres via testcontainer | vitest + drizzle |
| Admin happy-path | 1 e2e: load page → see data → 1 mutation | vitest + Testing Library OR handmatig |

Run lokaal:
```sh
pnpm --filter @webshop-crm/api test
pnpm --filter @webshop-crm/admin test
pnpm test                 # alle workspaces
```

## Workflow voor finalize / merge

1. Elke agent levert in eigen folder zonder andere folders te raken.
2. Atlas (of finalizer) merget door:
   - alle schema-files staan al naast elkaar
   - de 3 route-registraties (1 regel per agent in `routes/index.ts`) toe te voegen
   - de drizzle migration te regenereren (`pnpm db:generate`) zodat alle
     nieuwe schema's in 1 fresh migration komen
3. Operator runt `pnpm db:migrate` en `pnpm db:seed` (of feature-agent levert
   eigen seed-aanvulling via apart script `apps/api/src/db/seed-<feature>.ts`).
4. `pnpm dev` moet groen draaien zonder errors voor alle workspaces.

## Blockers waar je Atlas voor moet pingen

- Je hebt een nieuw V1-schema nodig dat niet in `DB-SCHEMA.md` staat
- Een andere agent's folder moet aangepast worden voor jouw feature
- Architectuurconflict (bv. money-precisie, idempotency-pattern niet duidelijk)
- Naming-collision in routes (`/api/products/:id` overlap met andere agent)

Doe dat via Hermes / shared/from-hermes/ of door direct STATUS-update met "BLOCKED"
state — Atlas verzint resolution.

## Wat is al klaar (foundation, NIET aanraken)

- Monorepo (`pnpm-workspace.yaml`, `tsconfig.base.json`)
- `docker-compose.dev.yml` (Postgres+Redis)
- `apps/api`: Hono boot, /health, /api/auth/*, env-loader, logger, db-client, idempotency
- `apps/admin`: TanStack Router, login-page, _app layout met auth-guard, sidebar, settings/logout, 4 placeholder-pages
- `packages/shared`: Money, auth-schemas, products-placeholder
- Drizzle 0000-migration met 14 V1-tabellen + updated_at-triggers
- Seed: 1 admin-user + 1 default location
- AI Centrum-thema in admin (zichtbaar op login + dashboard)
