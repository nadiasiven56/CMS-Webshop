# Webshop-CRM Admin — Extended preview pages (Atlas)

**Datum**: 2026-05-09
**Agent**: Atlas (agent1) — parallel run met Aether's design-polish
**Doel**: 15 extra preview-pages om de admin als **complete CRM-platform** te tonen, met realistische mock-data.

## Opgeleverd (15 / 15)

| # | Route | File | Status |
|---|---|---|---|
| 1  | `/orders` | `routes/_app/orders.tsx` | volledig |
| 2  | `/orders/$id` | `routes/_app/orders.$id.tsx` | volledig |
| 3  | `/customers` | `routes/_app/customers.tsx` | volledig |
| 4  | `/returns` | `routes/_app/returns.tsx` | volledig |
| 5  | `/locations` | `routes/_app/locations.tsx` | volledig |
| 6  | `/purchase-orders` | `routes/_app/purchase-orders.tsx` | volledig |
| 7  | `/suppliers` | `routes/_app/suppliers.tsx` | volledig |
| 8  | `/channels` | `routes/_app/channels.tsx` | volledig |
| 9  | `/channels/matrix` | `routes/_app/channels.matrix.tsx` | volledig |
| 10 | `/finance` | `routes/_app/finance.tsx` | volledig |
| 11 | `/accounting` | `routes/_app/accounting.tsx` | volledig (BONUS) |
| 12 | `/ledger` | `routes/_app/ledger.tsx` | volledig (BONUS) |
| 13 | `/settings/users` | `routes/_app/settings.users.tsx` | volledig (BONUS) |
| 14 | `/settings/tokens` | `routes/_app/settings.tokens.tsx` | volledig (BONUS) |
| 15 | `/settings/webhooks` | `routes/_app/settings.webhooks.tsx` | volledig (BONUS) |

## Nieuwe support-files

```
apps/admin/src/lib/mock-data-extended.ts   ← alle mock-data voor 15 pages (1 file)
apps/admin/src/lib/format.ts               ← formatMoney, formatDate, formatRelative, etc.
apps/admin/src/components/orders/Pills.tsx ← OrderStatusPill, PaymentStatusPill, ChannelPill, ChannelStatusPill
apps/admin/REGISTER-SIDEBAR.md             ← instructies voor Sidebar-wiring
apps/admin/EXTENDED-SUMMARY.md             ← dit document
```

## Mock-data overzicht

Alle 15 pages werken pure-frontend. Geen backend-calls. Data deterministisch via FNV-seeded RNG (zelfde patroon als Aether's `mock-data.ts`).

| Bron | Aantal | Inhoud |
|---|---|---|
| `MOCK_ORDERS` | 35 | mix van statuses, channels, B2C/B2B, NL/DE/BE/FR, met line-items + BTW + tracking |
| `MOCK_CUSTOMERS` | 28 | B2C + B2B, met VAT-nummers, telefoon, adres, LTV |
| `MOCK_RETURNS` | 12 | RMA's met reden + status + refund-bedrag |
| `MOCK_LOCATIONS_FULL` | 4 | warehouse / dropship / virtual / showroom |
| `MOCK_PURCHASE_ORDERS` | 14 | mix statuses + voortgang received/ordered |
| `MOCK_SUPPLIERS` | 8 | NL/IT/DE/ES/BE leveranciers met categorie + lead-time |
| `MOCK_CHANNELS` | 5 | GMC, Bol, Amazon, 2 storefronts |
| `MOCK_PRODUCT_CHANNEL_MATRIX` | 30 × 5 | 150 toggle-cellen |
| `MOCK_FINANCE_KPIS` | 1 | Q2 2026 KPI-set |
| `MOCK_CHANNEL_REVENUE` | 5 | omzet+marge per kanaal |
| `MOCK_VAT_BREAKDOWN` | 7 | NL-21/9, OSS-DE/FR/BE, EU-B2B-reverse, IOSS |
| `MOCK_UPCOMING_DECLARATIONS` | 6 | BTW-NL/OSS/ICP/IOSS Q1 + Q2 2026 |
| `MOCK_ACCOUNTING_CONNECTIONS` | 4 | Moneybird (sandbox), Exact Online (off), UBL, CSV |
| `MOCK_ACCOUNTING_EXPORTS` | 6 | recente exports met status |
| `MOCK_LEDGER` | 60 | journaalposten met DR/CR + ref + kanaal |
| `MOCK_ADMIN_USERS` | 4 | admin / fulfillment / finance / staff |
| `MOCK_API_TOKENS` | 5 | storefront/channel/admin/webhook scopes |
| `MOCK_WEBHOOKS` | 4 | Sendcloud, Bol, Zapier, Moneybird |

Alle bedragen, datums en counts zijn realistisch voor een MKB-shop op €85K kwartaal-omzet.

## Sidebar-wiring

**Niet door Atlas gedaan** — zoals afgesproken. Zie `REGISTER-SIDEBAR.md` voor:
- Welke iconen importeren uit `lucide-react`
- Welke nav-items toevoegen, in welke section
- Optionele badges (open-orders, open-retouren count)

3 nieuwe SECTIONS te wired: **Verkoop**, **Kanalen**, **Financieel** + uitbreiding van bestaande **Operations**-section.

## RouteTree

`routeTree.gen.ts` werd door TanStack auto-regeneratie tijdens dev-mode al bijgewerkt (Vite watcht de routes/-directory). Alle 15 nieuwe routes correct geregistreerd. `// @ts-nocheck`-header behouden.

## Niet aangeraakt

Conform scope:
- `_app/index.tsx`, `products*.tsx`, `stock*.tsx`, `movements.tsx`, `settings.tsx`, `_app.tsx`, `__root.tsx`, `login.tsx`
- `Sidebar.tsx`, `TopBar.tsx`
- `lib/mock-data.ts`, `lib/api-with-fallback.ts`, `lib/api.ts`, `lib/auth.ts`
- `components/product/*`, `components/stock/*`, `components/image/*`, `components/ui/*`
- `styles.css` (geen utility-classes nodig — alle bestaande primitives waren genoeg)

## TypeScript-check

Alle pages typeerd in strict mode. `// @ts-nocheck` enkel op `routeTree.gen.ts` (zoals voorgeschreven). Geen nieuwe deps toegevoegd — gebruik van bestaande `lucide-react` + Tailwind + standaard `Intl`-API.

## Bekende caveats / TODOs

1. **Loader voor `/orders/$id`** gebruikt `notFound()` uit TanStack Router; bij directe navigatie naar een onbekend order-nr toont dat de root-error-component. Werkt prima in dev — bij echte demo-data is elk `ORD-24001..ORD-24035` valide.
2. **Settings-page tabs**: de bestaande `/settings` (Aether's territorium) heeft de `<SettingsTabs>`-component nog niet geïmporteerd. Atlas kan die er optioneel later aan toevoegen om consistentie te krijgen.
3. **CategoryFilter / channel-multiselect** op `/orders` gebruikt simpele pill-toggles. Voor productie zou dit een echte multi-select dropdown worden — voor preview-doelen ruim voldoende.
4. **Mobile-tabel responsive**: tabellen scrollen horizontaal binnen `.table-wrap > div[overflow-x:auto]`. Op mobile gemiddeld OK, niet hoofd-focus.
5. **Customer-detail-page** is niet gebouwd (is V2-roadmap volgens task). Klant-link vanaf order-detail toont nu alleen pad naar `/customers`.
6. **Geen Toaster-state**: alle "Bewerken" / "Refund verwerken" / "Sync nu" knoppen zijn cosmetisch — geen click-handler. Voor preview = OK.
7. **Vite hot-reload**: nieuwe routes verschijnen direct na file-save. Bij eerste navigatie naar een nieuwe URL kan Vite even compileren.

## Hoe te testen

Vite draait op `http://127.0.0.1:7301` (of via tunnel). Klik vanaf bestaande dashboard naar:

```
http://127.0.0.1:7301/orders
http://127.0.0.1:7301/orders/ORD-24001
http://127.0.0.1:7301/customers
http://127.0.0.1:7301/returns
http://127.0.0.1:7301/locations
http://127.0.0.1:7301/purchase-orders
http://127.0.0.1:7301/suppliers
http://127.0.0.1:7301/channels
http://127.0.0.1:7301/channels/matrix
http://127.0.0.1:7301/finance
http://127.0.0.1:7301/accounting
http://127.0.0.1:7301/ledger
http://127.0.0.1:7301/settings/users
http://127.0.0.1:7301/settings/tokens
http://127.0.0.1:7301/settings/webhooks
```

Zonder sidebar-items zijn ze alleen via direct-URL bereikbaar. Na `REGISTER-SIDEBAR.md`-wiring verschijnen ze in het menu.

## Resultaat

Admin voelt nu als **echte CRM-platform** met volledige Shopify-Admin-achtige menu-rijkdom: Verkoop / Catalogus / Operations / Kanalen / Financieel / Account. Operator ziet alle Fase 2-4 features visueel, ook al draait de backend nog niet.
