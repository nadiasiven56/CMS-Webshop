# REGISTER — Finance UI (Agent E)

Wave 2 admin-UI. Alle pages draaien op de echte API (`/api/finance/*`), shop-scoped
via `useActiveShop()`. Geld blijft string (Money) → gerenderd via `formatMoney(money(x))`.

## Routes toegevoegd/gewijzigd

| Route-file | Pad | Doel |
|---|---|---|
| `routes/_app/finance.tsx` | `/finance` | Dashboard: KPI's (omzet/marge/BTW/COGS), periode-toggle, omzettrend-sparkline, per-kanaal-breakdown, P&L-tabel |
| `routes/_app/ledger.tsx` | `/ledger` | Grootboek: journaalposten-lijst + filters (account/datum/zoek) + totalen-footer + detail-Modal |
| `routes/_app/accounting.tsx` | `/accounting` | Boekhouding: OSS-CSV-export (per kwartaal), facturenlijst + detail-drawer met UBL-XML-download |

Mock-imports verwijderd: `lib/mock-data-extended`, `lib/mock-state`, `components/orders/Pills`
(ChannelPill hing op mock-data — vervangen door `channelLabel()`-helper).

## Componenten toegevoegd (`components/finance/`)

| File | Doel |
|---|---|
| `api.ts` | TanStack-Query hooks + DTO-types voor alle finance-endpoints + helpers (`money()`, `channelLabel()`) |
| `PnlTable.tsx` | Presentational P&L-tabel (voedt zich met `/pnl`-response) |
| `InvoiceDrawer.tsx` | Factuur-detail-drawer (regels/klant/totalen) + UBL-XML-download-knop |

## Sidebar-entries (Atlas wiret in Sidebar.tsx)

Geen nieuwe — `finance`, `ledger`, `accounting` staan al in de sidebar (sectie "Financieel"/"Finance").
Voorgestelde labels/iconen indien herziening nodig:
- sectie "Financieel": `{ label: 'Financieel', to: '/finance', icon: 'BarChart3' }`
- sectie "Financieel": `{ label: 'Grootboek', to: '/ledger', icon: 'BookOpenCheck' }`
- sectie "Financieel": `{ label: 'Boekhouding', to: '/accounting', icon: 'Receipt' }`

## Backend-endpoints gebruikt

| Endpoint | Waar | Params |
|---|---|---|
| `GET /api/finance/pnl` | finance.tsx (KPI's + P&L-tabel) | `shop_id`, `from`, `to` |
| `GET /api/finance/ledger/aggregate` | finance.tsx (per-kanaal + trend) | `shop_id`, `period=day\|week\|month`, `source=orders`, `from`, `to` |
| `GET /api/finance/ledger` | ledger.tsx (lijst + totalen) | `shop_id`, `account`, `from`, `to`, `limit`, `offset` |
| `GET /api/finance/invoices` | accounting.tsx (facturenlijst) | `shop_id`, `type`, `limit`, `offset` |
| `GET /api/finance/invoices/:id` | InvoiceDrawer (detail incl. ublXml) | — |
| `POST /api/finance/exports/ubl` | InvoiceDrawer (download) | body `{ invoice_id, persist:true }` → XML-body |
| `POST /api/finance/exports/oss` | accounting.tsx (download) | body `{ period:'YYYY-Q[1-4]', shop_id }` → CSV-body |

Exports gebruiken axios `responseType:'text'` + `downloadBlob()` uit `lib/downloads.ts`.

## Aanpasbaarheid / interactie

- **Facturen**: click-row → `InvoiceDrawer` (ESC + backdrop sluit via gedeelde `Drawer`),
  footer Sluiten/UBL-downloaden. Facturen zijn in het V1-backend immutable (gegenereerd
  uit orders) — drawer toont detail + genereert/download UBL i.p.v. veld-edit.
- **Grootboek**: click-row → detail-`Modal`. Ledger-entries zijn append-only
  journaalposten (geen edit-endpoint in backend) — read-detail is correct gedrag.

## Backend-gaps / observaties

1. **Geen invoice-create vanuit de UI gewired.** `POST /api/finance/invoices/generate`
   bestaat wel, maar genereert uit een `order_id` — dat hoort logischer bij de orders-UI
   (Agent C: "genereer factuur" vanuit order-detail). Bewust niet hier ingebouwd om
   folder-eigendom te respecteren. Facturenlijst is daardoor leeg tot orders facturen
   genereren (nette empty-state aanwezig).
2. **Aggregate levert geen kanaal-labels** — alleen ruwe `channel`-slug (of `null`=direct).
   Front-end mapt via `channelLabel()` (best-effort titlecasing + bekende slugs). Een
   `GET /api/channels`-koppeling zou nettere namen geven (Agent met channels-scope).
3. **Ledger-account-namen** zijn front-end-gemapt (`revenue`/`vat_payable`/`cogs`/…). De
   backend levert geen account-display-namen; lijst met 6 bekende accounts is hardcoded.
   Onbekende accounts vallen terug op de ruwe code.
4. **OSS-CSV** leidt af uit `ledger_entries.vat_country + vat_rate`. Als die kolommen leeg
   zijn levert de export een lege/minimale CSV — geen frontend-fout, maar de data hangt af
   van hoe orders geboekt zijn.
5. **Per-bucket trend** gebruikt `/ledger/aggregate` met dezelfde periode-bucket als het
   venster (dag→dag, kwartaal→week, jaar→maand). Bij <2 buckets toont de UI een nette
   "niet genoeg datapunten"-melding i.p.v. een platte lijn.

## Nieuwe deps

Geen. Alleen bestaande: `@tanstack/react-query`, `axios` (via `lib/api`), `lucide-react`,
gedeelde UI-components + `lib/format` + `lib/downloads` + `lib/shop-context`.

## TypeScript

Eigen files tsc-clean. Enige tsc-errors in de admin-build zitten in `routes/_app/cms.pages.tsx`
(andere agent, JSX-parse-fout) — buiten deze scope.
