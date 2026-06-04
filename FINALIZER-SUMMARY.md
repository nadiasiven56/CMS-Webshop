# Fase 1 — Finalizer summary

**Auteur**: Atlas (in finalizer-rol)
**Datum**: 2026-05-09
**Project-root**: `C:\ClaudeAgents\shared\from-agent1\webshop-crm\`

Foundation (Atlas) + 3 feature-agents (product / stock / image) zijn gemerged
tot 1 werkend Fase 1-geheel. Operator kan nu `pnpm install` + `pnpm db:up` +
`pnpm db:migrate` + `pnpm db:seed` + `pnpm db:seed-demo` + `pnpm dev` runnen.

---

## 1. Routes gewired

**Bestand**: `apps/api/src/routes/index.ts`

Volgens REGISTER.md instructies van alle 3 feature-agents:

```ts
import { productRoutes } from './products/index.js';
import { stockRoutes } from './stock/index.js';
import { movementsRoutes } from './movements/index.js';
import { imageRoutes } from './images/index.js';

apiRoutes.route('/products', productRoutes);
apiRoutes.route('/stock', stockRoutes);
apiRoutes.route('/movements', movementsRoutes);
apiRoutes.route('/images', imageRoutes);
```

**Resulterende endpoints**:

| Method | Path |
|---|---|
| GET    | `/api/products` |
| POST   | `/api/products` |
| GET    | `/api/products/:id` |
| PATCH  | `/api/products/:id` |
| DELETE | `/api/products/:id` |
| POST   | `/api/products/:id/variants` |
| PATCH  | `/api/products/:id/variants/:variantId` |
| DELETE | `/api/products/:id/variants/:variantId` |
| GET    | `/api/stock` |
| GET    | `/api/stock/:itemId` |
| POST   | `/api/stock/:itemId/adjust` |
| GET    | `/api/movements` |
| POST   | `/api/images` |
| PATCH  | `/api/images/:id` |
| DELETE | `/api/images/:id` |
| POST   | `/api/images/reorder/:productId` |

## 2. Static-serve voor uploads

**Bestand**: `apps/api/src/index.ts`

Boven `app.route('/api', apiRoutes)` toegevoegd:

```ts
import { serveStatic } from '@hono/node-server/serve-static';

app.use('/storage/*', serveStatic({ root: './', rewriteRequestPath: (p) => p }));
```

Dit zorgt dat uploaded images via `http://localhost:7300/storage/images/...`
geserveerd worden — vereist door image-agent.

## 3. ImageUploader-placeholder fix

Product-agent had `apps/admin/src/components/product/ImageUploader.tsx` als
placeholder gemaakt. Image-agent leverde de echte op
`apps/admin/src/components/ImageUploader.tsx`.

**Aangepast** (1 file gebruikte de placeholder):
- `apps/admin/src/routes/_app/products.$id.tsx` —
  `import { ImageUploader } from '@/components/product/ImageUploader'` →
  `import { ImageUploader } from '@/components/ImageUploader'`
- Call-site `<ImageUploader images={product.images} />` →
  `<ImageUploader productId={product.id} initial={product.images} />`
  (de echte component accepteert `productId` + `initial` i.p.v. `images`).

**Verwijderd**:
- `apps/admin/src/components/product/ImageUploader.tsx` (placeholder)

`ProductImageDto` (uit shared) en `ProductImage` (in real ImageUploader)
hebben dezelfde shape (id, productId, url, alt, position, createdAt) — dus
geen extra adapter nodig.

## 4. Workspace-deps verifieerd

- `apps/api/package.json` heeft `"@webshop-crm/shared": "workspace:*"` ✓ (toegevoegd door product-agent)
- `apps/admin/package.json` heeft `"@webshop-crm/shared": "workspace:*"` ✓ (toegevoegd door product-agent)
- `packages/shared/package.json` `name: "@webshop-crm/shared"` ✓
- `packages/shared/package.json` `exports`: `./api/auth`, `./api/products`, `./types/money` waren aanwezig.
  **Toegevoegd door finalizer**: `./api/images` (consistent met patroon, ondanks dat image-agent
  alleen via root-namespace `Images` importeert).

## 5. Drizzle-migration status

**Status**: in-sync. Geen drift.

- Schema-bestanden in `apps/api/src/db/schema/` (15 .ts files): users, sessions,
  api-tokens, locations, products, product-options, product-option-values,
  product-images, variants, inventory-items, inventory-levels, inventory-movements,
  inventory-reservations, audit-log, idempotency-keys.
- `apps/api/drizzle/0000_initial_foundation.sql` dekt al deze 15 tabellen
  + indexes + updated_at-triggers.
- Geen feature-agent heeft schema-files toegevoegd of gewijzigd
  (zoals expliciet bevestigd in alle 3 *-AGENT-SUMMARY.md's).

**Aanbeveling voor operator**: na eerste `pnpm install`, optioneel
`pnpm db:generate` runnen om Drizzle's eigen handgegenereerde-output te
laten samenvallen met handmatig SQL. Niet verplicht — `pnpm db:migrate`
gebruikt het journal en de bestaande SQL-file gewoon.

## 6. Seed-data — 50 demo-products

**Bestand**: `apps/api/src/db/seed-products.ts` (NEW)

- 50 producten over 5 product-types (10 per type): Koffiemachines, Hondenvoer,
  Kantoor, Tuin, Kitchen
- 1-3 varianten per product (random, deterministic seed)
- SKU-pattern: `<TYPE-CODE>-<NNN>-<idx>` (bijv. `KOF-001-1`, `HND-007-2`)
- Random prijzen 9.99-499.99
- Per variant 1 inventory_item + 1 inventory_level op default-location 'main'
  met random qty 0-100 (sommige op 0 voor low-stock-test)
- Status: 80% active, 15% draft, 5% archived
- 1-2 fake images per product met `https://picsum.photos/seed/<sku>/600/600`
  (geen echte upload — verifieerbaar dat image-routes werken doe je via UI)
- Idempotent: skip als slug LIKE `demo-%` al bestaat

**Verwacht na run**: 50 products + ~100 variants + ~100 inventory_items +
~100 inventory_levels + ~75 product_images.

**Scripts toegevoegd**:
- `apps/api/package.json` `scripts.seed:demo` = `tsx src/db/seed-products.ts`
- root `package.json` `scripts.db:seed-demo` = `pnpm --filter @webshop-crm/api seed:demo`

## 7. Playwright E2E

**Files**:
- `apps/admin/playwright.config.ts` (NEW)
- `apps/admin/e2e/v1-happy-path.spec.ts` (NEW) — 1 test, 6 stappen:
  1. /login → admin-credentials
  2. /products → search "koffie" + selecteer eerste product
  3. /products/:id → varianten zichtbaar
  4. /stock → low-stock-toggle
  5. /stock/:itemId → adjust +5 modal
  6. /movements → entry zichtbaar

**Scripts**:
- `apps/admin/package.json`: `test:e2e` = `playwright test`
- root `package.json`: `test:e2e` = `pnpm --filter @webshop-crm/admin test:e2e`

**Dep toegevoegd**:
- `@playwright/test@1.49.0` in `apps/admin/package.json` devDependencies
- Operator moet 1x `pnpm --filter @webshop-crm/admin exec playwright install chromium`
  runnen voor browser-binaries.

**NIET gerund** — operator doet dat zelf met live API+admin.

## 8. routeTree.gen.ts update

Toegevoegd (consistent met al aanwezige `AppStockItemIdRoute`):
- `AppProductsNewRoute` (`/products/new`)
- `AppProductsIdRoute` (`/products/$id`)

`// @ts-nocheck` behouden — Vite-router-plugin overschrijft deze file
op eerste `pnpm dev`.

## 9. DEV-SETUP.md

**Bestand**: `docs/DEV-SETUP.md` (NEW)

Bevat:
- Prerequisites (Node 22+, pnpm 9+, Docker)
- Initial setup (install, .env, db:up/migrate/seed/seed-demo)
- Daily workflow (`pnpm dev`)
- URLs (api/admin/health/storage)
- Test-commando's (vitest + playwright)
- DB-reset
- Troubleshooting (Docker, ports, workspace-deps, routeTree, drizzle-drift, login-cookies)
- Volgende fasen pointer

## 10. Backups gemaakt (zoals "Backups bij rewrite-passes" pattern)

- `apps/api/src/routes/index.ts.pre-finalize.bak`
- `apps/api/src/index.ts.pre-finalize.bak`
- `apps/api/src/db/seed.ts.pre-finalize.bak` (niet gewijzigd, voor zekerheid)
- `apps/admin/src/routes/_app/products.$id.tsx.pre-finalize.bak`
- `package.json.pre-finalize.bak` (root)

---

## Acceptance-criteria check (V1-ROADMAP §"Fase 1 — Foundation > Acceptance")

| # | Criterium | Status | Toelichting |
|---|---|---|---|
| 1 | `pnpm dev` start db+api+admin, alle 3 healthy in <30s | [⚠️ requires operator pnpm dev] | Code-pad in orde: docker-compose draait db, root `dev` script start api+admin parallel |
| 2 | Admin-login werkt, sessie persistent na reload | [⚠️ requires operator] | Foundation leverde dit al, geen wijzigingen in auth-flow |
| 3 | Product met 3 varianten + 2 foto's aanmaken via admin → in Postgres correct opgeslagen | [⚠️ requires operator] | Routes + admin-UI + image-uploader allemaal gewired |
| 4 | Stock-mutation +5 in default-location → movements-log toont entry met user+ts | [⚠️ requires operator] | Stock-adjust + movements-list gewired, audit_log + actor_id schreef stock-agent |
| 5 | Idempotency-key herhaling geeft cached response | [✓ codepath] | Globale `idempotency`-middleware staat al op `/api/*` (foundation), alle write-routes accepteren `Idempotency-Key` header |
| 6 | Drizzle migrate/rollback werkt 2 niveaus diep | [⚠️ requires operator] | Migrate werkt (foundation deed dit al). Rollback = `pnpm db:reset` → migrate. Echte 2-niveaus = pas Fase 2 (additive 0001-migration) |

### Detail-checks die wel op disk te verifiëren zijn

- [✓] Productie-routes bereikbaar onder `/api/products/*` — geverifieerd in `routes/index.ts`
- [✓] Stock-routes bereikbaar onder `/api/stock/*` + `/api/movements` — idem
- [✓] Image-routes bereikbaar onder `/api/images/*` — idem
- [✓] Static-serve `/storage/*` — toegevoegd aan `apps/api/src/index.ts`
- [✓] Admin importeert echte ImageUploader (component-merge fix)
- [✓] Drizzle-schema 1-op-1 met SQL-migration (15 tabellen)
- [✓] DEV-SETUP.md bestaat en covert install→dev→test→troubleshoot
- [✓] Demo-seed-script bestaat en is idempotent
- [✓] Playwright config + 1 happy-path test bestaan

---

## Open issues / risk-flags voor Atlas/operator

### Niet-blocking, maar belangrijk

1. **`bcryptjs` i.p.v. `argon2`**: foundation-summary documenteert dit al. Geen actie.
2. **`routeTree.gen.ts` is handmatig**: zal door Vite-plugin overschreven worden bij eerste
   `pnpm dev`. Test of de auto-gen-versie equivalent is — anders heb je een drift-bron.
3. **Demo-images via `picsum.photos` URLs** — geen echte uploads. Voor E2E-image-flow-test
   moet operator handmatig 1 product uploaden via UI (`apps/admin/src/components/ImageUploader.tsx`).
4. **Playwright spec is "best-effort"-locator-based** (geen `data-testid`-attributen in
   product/stock-pages). Bij UI-tweaks kunnen selectors breken. Toevoegen van
   `data-testid` is een volgende polish-iteratie.
5. **`movements`-import in REGISTER.md heette `movementRoutes` (zonder s)**, in stock-agent's
   actual code is het `movementsRoutes`. Finalizer gebruikte de correcte (export-naam) versie.
6. **Stock-agent test-mocks (mockt db) en product-agent test-mocks** — vitest passes maar
   integration-test met echte Postgres-testcontainer is uitgesteld naar Fase 2 (zoals
   INTEGRATION.md voorschrijft).

### Bug-flag (geen actie ondernomen — buiten finalizer-scope)

- **Geen** ontdekt. Alle 3 feature-agents respecteerden folder-eigendom strikt.

### Documentatie-discrepantie (info-only)

- Image-agent's REGISTER.md noemt het `imageRoutes`, en zo is het ook geëxporteerd —
  consistent met `apps/api/src/routes/images/index.ts`.
- Stock-agent's REGISTER.md noemt `movementsRoutes` — consistent met
  `apps/api/src/routes/movements/index.ts` export.

---

## Operator-quickstart (5 commando's)

```sh
cd C:\ClaudeAgents\shared\from-agent1\webshop-crm

pnpm install                 # workspace-deps
cp .env.example .env         # vul SESSION_SECRET, CHANNEL_SECRET_KEY, SEED_ADMIN_PASSWORD
pnpm db:up                   # Postgres + Redis
pnpm db:migrate              # 0000-foundation
pnpm db:seed && pnpm db:seed-demo   # 1 admin + 1 location + 50 demo-products
pnpm dev                     # api :7300 + admin :7301
```

Open `http://localhost:7301` → login met `admin@webshop-crm.local` +
`SEED_ADMIN_PASSWORD`. Verkennen: /products, /stock, /movements.

Voor E2E (later, optioneel):
```sh
pnpm --filter @webshop-crm/admin exec playwright install chromium
E2E_ADMIN_PASSWORD=<seed-password> pnpm test:e2e
```

---

## Bestanden gewijzigd / toegevoegd door finalizer

| Pad | Status |
|---|---|
| `apps/api/src/routes/index.ts` | EDITED (4 imports + 4 route mounts) |
| `apps/api/src/index.ts` | EDITED (serveStatic-import + middleware) |
| `apps/api/src/db/seed-products.ts` | NEW |
| `apps/api/package.json` | EDITED (seed:demo script) |
| `apps/admin/src/routes/_app/products.$id.tsx` | EDITED (ImageUploader-import-fix + props) |
| `apps/admin/src/components/product/ImageUploader.tsx` | DELETED (placeholder) |
| `apps/admin/src/routeTree.gen.ts` | EDITED (products.new + products.$id-routes) |
| `apps/admin/playwright.config.ts` | NEW |
| `apps/admin/e2e/v1-happy-path.spec.ts` | NEW |
| `apps/admin/package.json` | EDITED (test:e2e + @playwright/test dep) |
| `packages/shared/package.json` | EDITED (./api/images export) |
| `package.json` (root) | EDITED (db:seed-demo + test:e2e scripts) |
| `docs/DEV-SETUP.md` | NEW |
| `FINALIZER-SUMMARY.md` | NEW (deze file) |
| `*.pre-finalize.bak` | NEW (5 backups) |

**Totaal**: 5 NEW + 9 EDITED + 1 DELETED + 5 BAK.

## Status

`Fase 1 = code-complete` voor alles wat zonder live operator-action te
checken is. De resterende 4 acceptance-bullets vragen om `pnpm dev` op de
operator's machine.
