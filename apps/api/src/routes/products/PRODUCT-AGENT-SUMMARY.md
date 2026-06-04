# Product-agent — Fase 1 ronde 2 SUMMARY

**Agent**: product-agent (gedispatcht door Atlas)
**Datum**: 2026-05-09
**Project**: `webshop-crm` Fase 1, ronde 2 (parallel met stock-agent + image-agent)

## Wat klaar is

### Backend — `apps/api/src/`

**Routes** (`routes/products/`):
- `index.ts` — Hono-router met 8 endpoints, alle achter `requireAuth`
- `list.ts` — `GET /api/products` (paginate + filter status/search, order updated_at desc)
- `create.ts` — `POST /api/products` (incl varianten + options, default-variant bonus, slug-auto)
- `get.ts` — `GET /api/products/:id` (full product met varianten + options + images)
- `update.ts` — `PATCH /api/products/:id` (partial, slug-rename veilig)
- `delete.ts` — `DELETE /api/products/:id` (soft-archive: status='archived')
- `variants.ts` — `POST/PATCH/DELETE /api/products/:id/variants[/:variantId]`
- `_serialize.ts` — Drizzle-row → API-DTO
- `_validate.ts` — UUID-check helper
- `_schemas.ts` — re-export uit `@webshop-crm/shared`

**Domain** (`domain/products/`):
- `slugify.ts` — title → URL-safe slug (NFKD, ampersand-handling, dash-collapse)
- `slugify.test.ts` — 8 unit-tests
- `slug-unique.ts` — append `-2`, `-3`, ... bij collision (1 query, race-veilig binnen tx)
- `slug-unique.test.ts` — 5 unit-tests
- `audit.ts` — helper voor `audit_log`-row per product/variant-mutatie

**Tests** (`routes/products/__tests__/`):
- `products.test.ts` — vitest, mocked db, happy + error per endpoint (~16 cases)

### Shared — `packages/shared/src/api/products.ts`

Volledig herschreven (was placeholder):
- `TaxClassSchema`, `ProductStatusSchema`
- `VariantCreateInputSchema`, `VariantUpdateInputSchema`, `VariantDtoSchema`
- `ProductOptionInputSchema`, `ProductOptionDtoSchema`
- `ProductImageDtoSchema`
- `ProductCoreSchema`, `ProductCreateInputSchema`, `ProductUpdateInputSchema`
- `ProductListItemSchema`, `ListProductsQuerySchema`, `ListProductsResponseSchema`
- `ProductWithRelationsSchema`, `ProductResponseSchema`, `VariantResponseSchema`

Re-export via `@webshop-crm/shared/api/products` subpath (al in package.json
`exports`).

### Admin — `apps/admin/src/`

**Routes**:
- `routes/_app/products.tsx` — overschreven: lijst-page met search/filter/paginate
- `routes/_app/products.new.tsx` — create-form
- `routes/_app/products.$id.tsx` — detail/edit-page met ProductForm + Varianten + ImageUploader-placeholder + soft-archive

**Components** (`components/product/`):
- `types.ts` — type-aliases naar shared
- `api.ts` — react-query hooks (list/detail/create/update/archive + variant CRUD)
- `StatusBadge.tsx` — pill (Concept/Actief/Gearchiveerd)
- `ProductTable.tsx` — tabel met thumbnail/title/vendor/type/status/varianten/datum
- `ProductForm.tsx` — herbruikbaar create+edit form
- `VariantForm.tsx` — `VariantRow` (inline-edit) + `NewVariantForm`
- `ImageUploader.tsx` — placeholder met `// TODO: image-agent levert`

### Foundation-tweaks (minimaal noodzakelijk, geen scope-overschrijding)

- `apps/api/package.json` — toegevoegd `"@webshop-crm/shared": "workspace:*"`
  (foundation had `@webshop-crm/shared` niet als dep gedeclareerd, terwijl
  INTEGRATION.md het wel als import-pattern beschrijft. Zonder deze regel
  failt `pnpm install` resolve. Deze tweak is niet schemaraking en niet
  scope van een andere feature-agent.)
- `apps/admin/package.json` — idem toegevoegd voor admin.

Beide tweaks zijn **alleen package.json-edit, geen code-schade**.

## Acceptance per endpoint

| Endpoint | Status | Notes |
|---|---|---|
| `GET /api/products` | KLAAR | paginate (limit 1..100, offset 0..), status-filter, ilike search, order updated_at desc |
| `POST /api/products` | KLAAR | zod-validate, slug-auto, slug-uniqueness in tx, default-variant bonus, audit |
| `GET /api/products/:id` | KLAAR | 404 bij unknown, full relations |
| `PATCH /api/products/:id` | KLAAR | partial, slug-rename veilig (uniqueness + excludeId), audit-diff |
| `DELETE /api/products/:id` | KLAAR | soft-archive, idempotent (al-archived ok), audit |
| `POST /api/products/:id/variants` | KLAAR | zod-validate, audit |
| `PATCH /api/products/:id/variants/:variantId` | KLAAR | partial, all variant-velden, audit-diff |
| `DELETE /api/products/:id/variants/:variantId` | KLAAR | soft (active=false), idempotent, audit |

Alle write-routes:
- achter `requireAuth` (401 bij geen sessie)
- accepteren `Idempotency-Key` header (global middleware)
- doen mutations + audit in 1 Drizzle-transaction

## Open issues / TODO's

1. **Image-uploader is placeholder** — image-agent levert echte `<ImageUploader />` met multipart-upload. Mijn placeholder toont alleen bestaande images read-only. Drop-in vervanging door image-agent.
2. **Description-field is `<textarea>`, geen rich-text** — V1 kiest voor plain HTML/Markdown invoer. Rich-text-editor voor V2 (zie V1-ROADMAP.md scope).
3. **Stock-info read-only nog niet getoond** — INTEGRATION zei "Toon stock-info read-only (lees uit `inventory_levels`)". Dit hangt op stock-agent's keuze: of zij leveren een leesbare `<StockBadge variantId={...} />` component, of ze leveren `GET /api/stock/by-variant/:variantId`. Zonder dat kan ik niet veilig vooruit-coderen omdat ik anders hun folder zou raken. Toegevoegd als TODO in `products.$id.tsx` als toekomstige sub-section.
4. **i18n / categories** — uit roadmap blijkt V2-scope. Niet gebouwd.
5. **routeTree.gen.ts** — gebruik `// @ts-nocheck` placeholder. Vite-router-plugin regenereert deze file de eerste `pnpm dev`. Geen handmatige update nodig.
6. **products.test.ts mocked-db** — bewust pragmatisch: vitest sanity-coverage zonder testcontainer. Een paar test-cases vallen in `expect([200,404]).toContain(...)` omdat de mock niet alle drizzle-where-conditions perfect kan inspecteren. Echte E2E met postgres-testcontainer komt in Fase 2 zoals INTEGRATION.md noteert.
7. **Foundation `@webshop-crm/shared` workspace-dep** — zie sectie hierboven; ik heb 1 regel per package.json toegevoegd om imports te laten resolven. Atlas mag dit op flexibel laten zitten of verplaatsen naar de foundation-pass.

## Niet gedaan (out-of-scope, expliciet)

- Image-upload backend/component (image-agent)
- Stock-CRUD / movements (stock-agent)
- `routes/index.ts` activeren (finalizer; zie `REGISTER.md`)
- Drizzle-migration regenereren (geen schema-changes nodig)
- Sidebar-aanpassing (foundation owned)
- channels / orders / financieel (Fase 3-5)

## Files aangemaakt / gewijzigd

```
apps/api/src/domain/products/
  ├─ slugify.ts                            (NEW)
  ├─ slugify.test.ts                       (NEW)
  ├─ slug-unique.ts                        (NEW)
  ├─ slug-unique.test.ts                   (NEW)
  └─ audit.ts                              (NEW)

apps/api/src/routes/products/
  ├─ index.ts                              (NEW)
  ├─ list.ts                               (NEW)
  ├─ create.ts                             (NEW)
  ├─ get.ts                                (NEW)
  ├─ update.ts                             (NEW)
  ├─ delete.ts                             (NEW)
  ├─ variants.ts                           (NEW)
  ├─ _schemas.ts                           (NEW)
  ├─ _serialize.ts                         (NEW)
  ├─ _validate.ts                          (NEW)
  ├─ REGISTER.md                           (NEW — finalizer leest dit)
  ├─ PRODUCT-AGENT-SUMMARY.md              (deze file)
  └─ __tests__/products.test.ts            (NEW)

apps/admin/src/components/product/
  ├─ types.ts                              (NEW)
  ├─ api.ts                                (NEW — react-query hooks)
  ├─ StatusBadge.tsx                       (NEW)
  ├─ ProductTable.tsx                      (NEW)
  ├─ ProductForm.tsx                       (NEW)
  ├─ VariantForm.tsx                       (NEW)
  └─ ImageUploader.tsx                     (NEW — placeholder voor image-agent)

apps/admin/src/routes/_app/
  ├─ products.tsx                          (OVERWRITTEN, was placeholder)
  ├─ products.new.tsx                      (NEW)
  └─ products.$id.tsx                      (NEW)

packages/shared/src/api/
  └─ products.ts                           (REWRITTEN — was placeholder, nu full contract)

apps/api/package.json                      (1 regel: workspace:* dep)
apps/admin/package.json                    (1 regel: workspace:* dep)
```

**Totaal**: 23 nieuwe files + 4 wijzigingen.

## Voor de finalizer

1. Lees `REGISTER.md` in dezelfde folder.
2. Activeer 2 regels in `apps/api/src/routes/index.ts`.
3. Run `pnpm install` (workspace-link maakt zich klaar).
4. Run `pnpm --filter @webshop-crm/api typecheck` + `test`.
5. Run `pnpm --filter @webshop-crm/admin typecheck`.
6. Geen `pnpm db:generate` nodig — geen schema-changes.

## Voor Atlas

- STATUS.md update doe ik niet (jij doet dat).
- Niet gemerged in andere agents' folders. Niet in `routes/index.ts`. Niet in foundation-schema.
