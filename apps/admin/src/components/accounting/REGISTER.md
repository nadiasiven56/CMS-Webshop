# REGISTER — admin-UI: Boekhoud-koppeling, Webhook-log, Audit-log

**Atlas — admin-UI voor 3 pagina's (koppel-klaar backends bestaan al & zijn gemount).**
Strikt binnen mijn scope geschreven; GEEN edits aan `Sidebar.tsx`, `routeTree.gen.ts`,
`settings.webhooks.tsx` of andere features. De finalizer/orchestrator wiret de
sidebar-entries hieronder.

De `channels`-admin-feature is 1-op-1 als blueprint gevolgd (api.ts query-key-factories +
`invalidateQueries`, masked creds "Gezet"/"Niet gezet", money STRING, layout-routes puur
`<Outlet/>`, index-route-id eindigt op `/`, ui/* hergebruikt, Dutch labels,
`noUncheckedIndexedAccess` via helper-accessors i.p.v. directe Record-indexering).

---

## 1. Sidebar-entries (orchestrator voegt toe aan `apps/admin/src/components/Sidebar.tsx`)

### 1a. Imports uitbreiden
In het `lucide-react`-import-blok bovenaan (regels ~2-24) deze twee namen TOEVOEGEN
(`Receipt` is er al — NIET nogmaals toevoegen):

```ts
  Webhook,
  ScrollText,
```

Beide bestaan in de geïnstalleerde `lucide-react` (geverifieerd).

### 1b. Entry "Boekhoud-koppeling" — in de bestaande sectie **Financieel**
> LET OP: de label **"Boekhouding"** bestaat al in deze sectie (→ `/accounting`, de oude
> finance-facturen/exports-pagina). Mijn nieuwe pagina is óók `/accounting` (zie §3).
> Vervang/actualiseer de bestaande regel naar het nieuwe label:

```ts
{ label: 'Boekhoud-koppeling', to: '/accounting', icon: Receipt },
```

(Plaats in `SECTIONS` → sectie `{ label: 'Financieel', items: [...] }`, ter vervanging van
de huidige `{ label: 'Boekhouding', to: '/accounting', icon: Receipt }`. `/finance` en
`/ledger` blijven ongewijzigd in dezelfde sectie.)

### 1c. Nieuwe sectie **Systeem** — Webhook-log + Audit-log
Voeg een nieuwe sectie toe (logisch ná `Financieel`, vóór `Account`):

```ts
{
  label: 'Systeem',
  items: [
    { label: 'Webhook-log', to: '/webhooks', icon: Webhook },
    { label: 'Audit-log', to: '/audit-log', icon: ScrollText },
  ],
},
```

> `/webhooks` is de DELIVERY-MONITOR. De webhook-CRUD blijft op `/settings/webhooks`
> (onaangeroerd) — dit is een aparte pagina, GEEN duplicaat.

---

## 2. Routes (auto-gewired door de TanStack file-route-plugin)

Nieuwe/aangepaste route-bestanden onder `apps/admin/src/routes/_app/`:

| Bestand | Route-id | Inhoud |
|---|---|---|
| `accounting.tsx` (AANGEPAST → puur `<Outlet/>`) | `/_app/accounting` | layout |
| `accounting.index.tsx` (NIEUW) | `/_app/accounting/` | koppelingen-grid + sync-log |
| `webhooks.tsx` (NIEUW) | `/_app/webhooks` | layout |
| `webhooks.index.tsx` (NIEUW) | `/_app/webhooks/` | delivery-monitor + test-fire |
| `audit-log.tsx` (NIEUW) | `/_app/audit-log` | layout |
| `audit-log.index.tsx` (NIEUW) | `/_app/audit-log/` | filterbare log + detail-drawer |

De vite-plugin (`@tanstack/router-plugin`) regenereert `routeTree.gen.ts` automatisch bij
`pnpm dev`/build — NIET handmatig editen.

### ⚠️ Conflict-notitie: `/accounting`
`accounting.tsx` was de finance-facturen/OSS/UBL-pagina (sidebar "Boekhouding"). Mijn
opdracht maakt `/accounting` de **Boekhoud-koppeling**-pagina. Ik heb:
- de oude inhoud bewaard als `accounting.tsx.pre-koppeling.bak` (in dezelfde route-map),
- `accounting.tsx` omgezet naar een pure layout (`<Outlet/>`),
- de koppeling-pagina in `accounting.index.tsx` gezet.

De facturen/exports-data is **niet verloren**: dezelfde cijfers staan op `/finance` en
`/ledger`. Wil de orchestrator de oude facturen-tabel behouden als sub-route, plaats dan
de `.bak`-inhoud als bijv. `accounting.invoices.tsx` (route-id `/_app/accounting/invoices`,
component-pad `createFileRoute('/_app/accounting/invoices')`) — buiten mijn scope, daarom
niet gedaan.

---

## 3. Geconsumeerde endpoints (alle achter `requireAuth`, baseURL `/api`)

### Boekhoud-koppeling — `/api/accounting`
- `GET    /accounting/connections` (`?provider=&status=&limit=&offset=`)
- `POST   /accounting/connections` `{provider, name, config?}`
- `GET    /accounting/connections/:id`
- `PATCH  /accounting/connections/:id` `{name?, config?, status?}`
- `DELETE /accounting/connections/:id`
- `PUT    /accounting/connections/:id/credentials` (per-provider creds-shape)
- `POST   /accounting/connections/:id/test-connection`
- `POST   /accounting/connections/:id/sync` `{scope:'invoices'|'orders', from?, to?}`
- `GET    /accounting/connections/:id/sync-log` (`?status=&entityType=&limit=&offset=`)

Providers + creds: moneybird `{accessToken}` + config `{administrationId}`; exact
`{accessToken, refreshToken, clientId, clientSecret}` + config `{division}`; eboekhouden
`{username, securityCode1, securityCode2}`.

### Webhook-log — `/api/webhooks`
- `GET  /webhooks/deliveries` (`?webhook_id=&event=&success=&limit=&offset=`)
- `GET  /webhooks/deliveries/:id`
- `POST /webhooks/test-fire` (`{webhookId}` óf `{event, url, secret?}`) — UI gebruikt ad-hoc
- `GET  /webhooks/events`

### Audit-log — `/api/audit`
- `GET /audit` (`?entityType=&action=&actorId=&entityId=&from=&to=&limit=&offset=`)
- `GET /audit/:id`

---

## 4. Geleverde bestanden

Components:
- `components/accounting/{api.ts, AccountingStatusPill.tsx, AccountingConfigDrawer.tsx, SyncLogTable.tsx, REGISTER.md}`
- `components/webhooks/{api.ts, DeliveryDetailDrawer.tsx, TestFireModal.tsx}`
- `components/audit/{api.ts, AuditDetailDrawer.tsx}`

Routes (`routes/_app/`):
- `accounting.tsx` (→ layout), `accounting.index.tsx`
- `webhooks.tsx`, `webhooks.index.tsx`
- `audit-log.tsx`, `audit-log.index.tsx`

---

## 5. Conventie-notities
- **Masked creds**: presence-map (`credentials[field] === 'set'`) → card toont
  "Gezet"/"Niet gezet"; drawer toont per veld placeholder "Gezet (laat leeg om te
  behouden)" en stuurt alleen ingevulde velden (lege submit overschrijft niet).
- **Money STRING**: sync-log `raw`/bedragen blijven string; nergens `Number()`-coercie op
  geld in deze UI.
- **`noUncheckedIndexedAccess`**: de provider-meta-map wordt benaderd via `providerMeta()`
  (switch), nooit via directe Record-indexering.
- **Audit `total`**: het backend-list-endpoint geeft GEEN `total` terug → paginatie is
  een heeft-meer-heuristiek (volle pagina = waarschijnlijk meer).
- **Webhook test-fire** schrijft zelf een delivery-log-rij → de mutation invalideert de
  deliveries-query, dus de nieuwe regel verschijnt direct in de tabel.
