# REGISTER — finance (`routes/finance/`)

**Agent 6 — Wave 1.** Strikt in `apps/api/src/routes/finance/` + `apps/api/src/domain/finance/` + `apps/api/src/db/seed-vat.ts`. Geen andere folders aangeraakt. Schema BEVROREN — geen wijzigingen.

## Mount (Atlas voegt toe aan `routes/index.ts`)

```ts
// imports (boven `export const apiRoutes`)
import { financeRoutes } from './finance/index.js';

// op de feature-agent registration slot
apiRoutes.route('/finance', financeRoutes);
```

Alle endpoints zitten achter `requireAuth` (cookie-sessie). `financeRoutes.use('*', requireAuth)` staat al in de router zelf — Atlas hoeft geen extra middleware toe te voegen.

## Seed-hook (Atlas: aan de seed-flow hangen)

Nieuw bestand: `apps/api/src/db/seed-vat.ts`, exporteert `seedVatRates()` (idempotent, `onConflictDoNothing` op `UNIQUE(country, tax_class, valid_from)`).

Voeg het toe aan de hoofd-seed (`apps/api/src/db/seed.ts`):

```ts
import { seedVatRates } from './seed-vat.js';
// ... binnen main(), na seedDefaultLocation():
await seedVatRates();
```

Of los draaien: `pnpm --filter @webshop-crm/api exec tsx src/db/seed-vat.ts`
(het bestand heeft een eigen CLI-entry die alleen draait bij directe uitvoer).

Dataset V1: NL 21/9/0 · DE 19/7/0 · FR 20/5.5/0 · BE 21/6/0 (12 rijen). Uitbreidbaar naar 27 EU-landen in Fase 4 via `VAT_SEED_ROWS`.

## Endpoints (allemaal `/api/finance/*`)

| Method | Path | Beschrijving |
|---|---|---|
| GET  | `/vat-rates`              | Alle BTW-tarieven (filter `?country=NL&tax_class=standard`) |
| GET  | `/vat-rates/lookup`       | `?country=NL&tax_class=standard` → meest recente geldige rate (404 als onbekend) |
| GET  | `/ledger`                 | `ledger_entries` paginated + filter (shop/order/account/channel/from/to) |
| GET  | `/ledger/aggregate`       | Omzet/marge/BTW/COGS per shop+kanaal+periode-bucket. `?period=day\|week\|month`, `?source=orders\|ledger` |
| GET  | `/pnl`                    | P&L-totalen (omzet/COGS/marge/BTW/verzend) per shop+periode (`?shop_id&from&to`) |
| GET  | `/invoices`               | Invoices list (filter shop/status/type, paginated) — `ublXml` weggelaten |
| GET  | `/invoices/:id`           | Invoice detail incl. `ublXml` |
| POST | `/invoices/generate`      | Genereert invoice uit een order. Body: `{order_id, type?, invoice_number?}`. Lines gesnapshot in `lines` jsonb. 409 als sales-invoice al bestaat |
| POST | `/exports/ubl`            | UBL 2.1 (SI-UBL/NLCIUS) XML uit een invoice. Body: `{invoice_id, supplier?, persist?}`. Slaat default op in `invoices.ubl_xml`, geeft XML als download-body |
| POST | `/exports/oss`            | OSS-CSV per land+tarief over een kwartaal. Body: `{period:'YYYY-Q[1-4]', shop_id?, rows?}`. Afgeleid uit `ledger_entries` of expliciete rows |

### Rekenconventies
- **Geld = string** (Money). Aggregaties rekenen in **hele centen** (`domain/finance/vat-math.ts`) → geen float-drift; output altijd 4-decimalen-string.
- Arrays in WHERE via **`inArray`** (financial_status-filter), nooit `= ANY(...)`.
- `source=orders`: omzet = `orders.subtotal` (netto), BTW = `taxTotal`, COGS = `sum(order_items.cost_price × quantity)`, marge = omzet − COGS. Telt alleen `financial_status ∈ {paid, partially_refunded, refunded}`.
- `source=ledger`: omzet = credit−debit op account `revenue`, BTW op `vat_payable`, COGS op `cogs`.

### date_trunc-let-op (voor latere uitbreiders)
`period` wordt als **RAW literal** in `date_trunc('month', ...)` geïnjecteerd (via `sql.raw`), NIET als bound parameter. Een geparametriseerde `date_trunc($1, ...)` triggert Postgres-fout `42803` ("must appear in GROUP BY") omdat de SELECT- en GROUP-BY-expressie dan niet gelijk worden geacht. `period` is een gevalideerde zod-enum, dus injectie is veilig.

## Schema-verzoeken

**Geen.** Alle 5 financiële tabellen (`vat_rates`, `ledger_entries`, `invoices`, `payouts`, `accounting_exports`) + `orders`/`order_items`/`shops` bestonden al (migratie 0001). Geen kolommen toegevoegd of gewijzigd. `db:generate` niet nodig.

Opmerking: `payouts` en `accounting_exports` hebben (nog) geen eigen route in deze Wave — ze zijn schema-ready; export-resultaten worden V1 als download-body teruggegeven i.p.v. een rij in `accounting_exports` weg te schrijven (kan in Fase 4 met een `?persist`-flag die een `accounting_exports`-rij + `file_path` aanmaakt).

## Tests

`apps/api/src/routes/finance/__tests__/finance.test.ts` — **echte DB** (geen mock van `db`, alleen `requireAuth` gemockt).

Draai: `pnpm -C "<repo>" --filter @webshop-crm/api test`
(of alleen finance: `pnpm --filter @webshop-crm/api exec vitest run src/routes/finance/__tests__/finance.test.ts`)

Dekt (17 cases, **17/17 PASS**):
- pure VAT-math (centen round-trip, splitVat incl/excl, marge)
- `seedVatRates()` idempotent (2e run insert=0) + NL-21 aanwezig
- BTW-lookup endpoint (DE→19, onbekend→404, invalid→400)
- ledger-aggregatie `source=orders` (omzet 100 / BTW 21 / COGS 60 / marge 40 / 40%)
- P&L-overzicht
- invoice genereren uit order (+ 2e sales-keer → 409)
- UBL-export → well-formed XML (`isWellFormedXml`) + persist in DB
- invoice-detail incl. ublXml
- OSS-CSV-export (header + regels) + invalid period → 400

Test seedt eigen shop/order/items met unieke slug en **ruimt alles op** in `afterAll` (FK-veilige volgorde).

> NB: pre-bestaande failures in `routes/products`, `routes/stock/adjust` en `lib/storage/sanitize` (lightweight db-mock-routing, niet finance-gerelateerd) staan los van deze module en bestonden al vóór deze agent.
