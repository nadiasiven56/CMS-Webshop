# Stock-agent — Levering-summary

**Auteur**: Atlas (in stock-agent rol)
**Datum**: 2026-05-09
**Scope**: Fase 1 ronde 2 — stock-routes + movements-routes + admin-pages.

## Acceptance per endpoint

### `GET /api/stock` — overview
- [x] Paginated lijst van `inventory_items` met aggregated stock-totals over alle
      locations (sum on_hand / available / committed / incoming, count(distinct
      location_id) en bool_or low_stock-flag) — 1 round-trip via Drizzle aggregate.
- [x] Pagination (`page`, `pageSize`, default 50, max 200).
- [x] Search op SKU (item.sku + variant.sku) en titel (product.title) via ilike.
- [x] Sort: `sku_asc|desc`, `available_asc|desc`, `on_hand_asc|desc`.
- [x] Filter `lowStockOnly=true` via `having bool_or(...)`.
- [x] Query-validation via zod, 400 op invalid input.
- [x] Achter `requireAuth`.

### `GET /api/stock/:itemId` — detail
- [x] Header met item + variant + product (id+title+status).
- [x] `totals`-object met aggregated cijfers over alle locations.
- [x] `locations[]` array met per-location breakdown (locationId, code, name,
      type, onHand, available, committed, incoming, minStock, reorderPoint,
      reorderQty, lowStock-flag, updatedAt).
- [x] `recentMovements[]` — 10 meest recente movements voor dit item, joined
      met locations.
- [x] 404 op item-not-found, 400 op invalid uuid.
- [x] Achter `requireAuth`.

### `POST /api/stock/:itemId/adjust`
- [x] Body-validation via zod: `{ location_id, delta (int, !=0), reason, note? }`.
- [x] In Drizzle-transaction (`runInTransactionWithAudit`):
  1. `applyDeltaAndRecompute` updatet inventory_levels.on_hand += delta en zet
     `available = on_hand - committed`. Insert nieuwe row als (item, location)
     nog geen level heeft.
  2. Insert in `inventory_movements` met `actor_id = user.id`, `reason` uit body,
     `ref_type = 'manual'`, `note`.
  3. `audit_log`-row geschreven via `audit.set(...)` builder.
- [x] 404 op invalid item / location.
- [x] 422 op inactive location (`location_inactive`).
- [x] 422 op negatief on_hand (`negative_stock`) tenzij `?force=true` querystring.
- [x] 400 op delta=0 of missing reason.
- [x] Achter `requireAuth`.
- [x] Idempotency via global `idempotency`-middleware (geen extra werk; client
      stuurt `Idempotency-Key` header).

### `GET /api/movements` — read-only audit-trail
- [x] Paginated (default 50/page, max 200).
- [x] Filters: `item_id`, `location_id`, `reason`, `from_date`, `to_date`
      (ISO-datetime strings).
- [x] Sort altijd `created_at desc`.
- [x] Joined met `inventory_items` (sku), `locations` (code+name) en `users`
      (actor email).
- [x] Achter `requireAuth`. Geen edit/delete-endpoint — read-only.

## Files aangemaakt

### Backend (api)
- `apps/api/src/routes/stock/index.ts` — Hono-router met 3 endpoints.
- `apps/api/src/routes/stock/REGISTER.md` — instructies voor finalizer.
- `apps/api/src/routes/stock/STOCK-AGENT-SUMMARY.md` — dit bestand.
- `apps/api/src/routes/stock/__tests__/adjust.test.ts` — vitest, 10 cases.
- `apps/api/src/routes/stock/__tests__/overview.test.ts` — vitest, 7 cases.
- `apps/api/src/routes/stock/__tests__/available-recompute.test.ts` — pure
  unit-tests voor de domain helper, 5 cases.
- `apps/api/src/routes/movements/index.ts` — Hono-router met 1 endpoint.
- `apps/api/src/domain/stock/available-recompute.ts` — `applyDeltaAndRecompute`
  + `recomputeAvailable` + `getLevel` + `NegativeStockError`.
- `apps/api/src/domain/stock/transaction-helpers.ts` — `runInTransactionWithAudit`
  + `writeAudit` + `AuditBuilder`.

### Admin (frontend)
- `apps/admin/src/routes/_app/stock.tsx` — overschreven, lijst-pagina met
  search + sort + lowStockOnly + pagination.
- `apps/admin/src/routes/_app/stock.$itemId.tsx` — nieuwe detail-route met
  per-location cards + adjust-modal + recent-movements.
- `apps/admin/src/routes/_app/movements.tsx` — overschreven, read-only tabel
  met date-range + reason-dropdown + item-search + pagination.
- `apps/admin/src/components/stock/StockTable.tsx`
- `apps/admin/src/components/stock/StockAdjustModal.tsx`
- `apps/admin/src/components/stock/MovementsTable.tsx`
- `apps/admin/src/components/stock/LocationStockCard.tsx`
- `apps/admin/src/routeTree.gen.ts` — toegevoegd: `AppStockItemIdRoute` voor
  TypeScript-resolver. Vite-plugin overschrijft dit op eerste run.

## Geen schema-changes

Stock-agent heeft GEEN nieuwe schema-files nodig. Alle gebruikte tabellen
(`inventory_items`, `inventory_levels`, `inventory_movements`,
`inventory_reservations`, `locations`, `audit_log`) waren al door foundation
aangemaakt. **Geen `pnpm db:generate` nodig.**

## Open TODO's / followups

1. **Postgres-integration tests** — huidige tests gebruiken vi.mock voor `db`
   en `runInTransactionWithAudit`. Echte SQL-correctheid (transaction-rollback
   bij movement-insert-error, concurrent adjust race-condition, `having`-clause
   voor lowStockOnly) moet via testcontainer-vitest in V1-finalize.

2. **Movements item-search** — frontend filter `Item-SKU bevat` is post-fetch
   (filtert alleen de huidige page). Bij echt gebruik zou dit als `item_sku=`
   query-param moeten landen op de backend en daar via `ilike` op
   `inventoryItems.sku`. Opgelost wanneer er een products-search-endpoint is
   (product-agent levert).

3. **Reservations-CRUD** — buiten scope. We tonen alleen `committed` getal in
   stock-detail (komt rechtstreeks uit `inventory_levels.committed`). Wanneer
   orders-agent (Fase 2-3) reservations creëert/cancelt, moet die agent
   `recomputeAvailable(tx, itemId, locationId)` aanroepen om de `available`
   consistent te houden.

4. **Idempotency-test** — niet expliciet getest. De global middleware staat
   al actief op `/api/*`, dus stock-adjust krijgt automatisch idempotent-replay
   bij duplicate `Idempotency-Key`. Validatie volgt in V1-finalize-pass.

5. **Location-list endpoint** — admin-UI zou nuttig profiteren van een
   `GET /api/locations` zodat de adjust-modal kan tonen welke andere locations
   bestaan. V1: stock-detail toont alleen locations waar al een level-row is.
   Buiten stock-agent-scope; kan een toekomstige micro-agent oppakken.

6. **Mobile responsive** — tabellen zijn niet expliciet gehard voor 390x844.
   Wel scrollbaar via `card { overflow: hidden }` op container, maar smalle
   schermen kunnen horizontal-scroll nodig hebben. Polish-pass voor V1-finalize.

## Constraints respect

- ✅ Drizzle-transaction op adjust (`runInTransactionWithAudit` wraps `db.transaction`).
- ✅ Negative on_hand → 422 + `?force=true` override.
- ✅ `available = on_hand - committed` consistent gehouden in `applyDeltaAndRecompute`.
- ✅ `audit_log`-row binnen dezelfde transactie als movement+level-update.
- ✅ Performance: aggregate-query op overview is 1 round-trip via Drizzle's
  `sum()/count(distinct)/bool_or()`-helpers — geen N+1.
- ✅ Geen routes/index.ts edit (zie REGISTER.md voor finalizer).
- ✅ Geen schema-foundation-files of andere agents' folders aangeraakt.
- ✅ Geen Sidebar of __root.tsx of _app.tsx aangepast.

## Run-instructies (na finalizer)

```sh
# Vanuit project-root
pnpm install                                       # zou al moeten zijn
pnpm --filter @webshop-crm/api test                # adjust + overview + recompute tests
pnpm --filter @webshop-crm/api typecheck           # tsc --noEmit
pnpm --filter @webshop-crm/admin typecheck         # tsc --noEmit
pnpm --filter @webshop-crm/api dev                 # API op :7300
pnpm --filter @webshop-crm/admin dev               # admin op :7301
```

Open `http://localhost:7301/stock` na login. Maak eerst via product-agent of
seed een `inventory_items`-row aan; daarna kan adjust voorraad inboeken.
