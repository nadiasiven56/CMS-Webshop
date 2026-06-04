# Webshop-CRM Admin · Interaction-pass

**Datum**: 2026-05-09
**Agent**: Atlas (agent1) — interaction-pass-agent
**Doel**: alle 20+ pages écht klikbaar maken — drawers, modals, filters, mutaties, toasts.

## TL;DR

- **vite build groen** in ~3.7s, 0 nieuwe TS-errors (4 pre-existing van Aether/feature-agents zijn er nog).
- **Alle hoofd-CTA's werken**: drawers openen, mutaties zichtbaar in lijsten, toast verschijnt+verdwijnt.
- **Mock-state in localStorage** persisteert mutaties over reload via `webshop-crm:mock-state:v1`.
- **Login werkt in DEMO_MODE** met simulated 800ms latency, "Demo-credentials invullen"-knop, "Onthouden"-checkbox.
- Backups: `.pre-interaction.bak` op alle 16 aangepaste page-files.

## Nieuwe foundation

### UI-helpers (in `src/components/ui/`)

| File | Wat |
|---|---|
| `Drawer.tsx` | Slide-in van rechts (desktop) / bottom-sheet (mobile <720px). ESC-handler + backdrop-click close. body-scroll-lock. Header (title/subtitle/X) + body + footer-slot. |
| `Modal.tsx` | Center, max-width 480px default. ESC + backdrop close (override met `lockBackdrop`). |
| `ConfirmDialog.tsx` | Variant van Modal voor "weet je het zeker?" met danger/primary-style. |
| `FormField.tsx` | Label + slot + error + hint, met optionele inline-mode. |

Aether's bestaande `Toast.tsx` (event-bus + auto-dismiss) wordt hergebruikt — er is een dunne wrapper bijgebouwd.

### Toast-helper

`src/lib/toast.ts` — wrapper rond Aether's `toastBus`:
```ts
import { toast } from '@/lib/toast';
toast.success('Order verzonden');
toast.error('Adjust niet mogelijk');
toast.info('Komt in Fase 2');
```

### Mock-state-store

`src/lib/mock-state.ts` — centrale mutable state met `useSyncExternalStore`-hooks per dataset:

| Hook | Action-object | Wat |
|---|---|---|
| `useOrders()` | `orderActions` | list/get/setStatus/cancel/generateTrackingNumber/add/update |
| `useCustomers()` | `customerActions` | list/get/add/update |
| `useReturns()` | `returnActions` | list/setStatus/setRefundAmount |
| `useLocations()` | `locationActions` | list/add/update/toggleActive |
| `usePurchaseOrders()` + `usePoLines(id)` | `poActions` | list/get/lines/setStatus/receiveLine/add — incl. afgeleide synthetische line-items |
| `useSuppliers()` | `supplierActions` | list/add/update/toggleActive |
| `useChannels()` | `channelActions` | list/toggleActive/setLastSync/saveConfig/getConfig |
| `useMatrix()` | `matrixActions` | list/toggleCell/bulkSetForChannel |
| `useUsers()` | `userActions` | list/add/update/remove |
| `useTokens()` | `tokenActions` | list/add/revoke |
| `useWebhooks()` | `webhookActions` | list/add/update/remove |
| `useAccountingConnections()` | `accountingActions` | list/connect |

Persistence naar `localStorage` met key `webshop-crm:mock-state:v1`. Helper `resetMockState()` wist de store en herlaadt.

## Per-page bedrade

### `/login`
- Demo-mode submit: simulated 800ms delay → `useLogin` (return MOCK_USER) → navigate naar `/`.
- "Onthouden"-checkbox schrijft `webshop-crm:demo-auth=1` naar localStorage.
- "Demo-credentials invullen" pre-fills email+password.
- Logout (in `/settings`) clear queryClient + localStorage.

### `/` (Dashboard)
- Quick-actions: Nieuw product → navigate; Voorraad → navigate; Movements → navigate; **Genereer GMC-feed** (loading 700ms → toast); **Push naar Moneybird** (loading 700ms → toast).
- KPI/charts blijven Aether's design.

### `/orders`
- Search debounced 250ms (filter op order-nr/klant/SKU).
- Status-tabs filteren live, channel multi-pills filteren, date-range-pickers filteren.
- "Wis filters"-knop reset alle filters.
- KPI-cards "Open" en "Te verzenden" zijn klikbaar (zet status-tab).
- Row-click → navigate naar detail.
- Action-menu (`MoreHorizontal` per row): Open / Print factuur (`toast.info "Fase 4"`) / Annuleer order (ConfirmDialog → cancel + toast).
- "+ Handmatige order"-knop → drawer met klant-select / SKU / qty / unitPrice / shippingMethod → submit → 350ms → `orderActions.add` + toast → row verschijnt.

### `/orders/$id`
- Loader leest uit `orderActions.get` (live mock-state).
- "Verzendlabel"-knop → modal met carrier/gewicht/dims → 600ms → `generateTrackingNumber` + status='shipped' + shippedAt + toast.
- "Refund"-knop → modal met bedrag + reden + partial-checkbox → 500ms → paymentStatus='refunded' (of partially_refunded) + toast.
- "Annuleer order"-knop → ConfirmDialog → status='cancelled' + toast.
- "Bevestiging" + "Stuur bevestiging opnieuw" → toast.success.
- "Factuur" + "Pak-bon" → `toast.info "Komt in Fase 4"`.
- **Fulfillment-stappen klikbaar**: alleen volgende stap is reachable (gestippelde rand). Click → `setStatus` + toast.
- "Markeer Allocated/Picked/Shipped/Delivered"-knop in fulfillment-card.

### `/customers`
- Search debounced (naam/email/bedrijf/stad/BTW), type-tabs (Alle/B2C/B2B), country-dropdown.
- Row-click → drawer met avatar + adres + stats (Orders/LTV/Last) + recente 5 orders (link naar order-detail).
- "+ Klant toevoegen"-drawer met type-toggle B2C/B2B, naam/email/telefoon, optioneel bedrijf+BTW, adres → submit → `customerActions.add` + toast.

### `/returns`
- Search debounced + status-tabs + reden-multi-pills.
- Row-click → drawer met badges + reden-detail + stats + link naar order.
- Footer-actions (afhankelijk van status): Goedkeuren / Afwijzen (ConfirmDialog) / Markeer ontvangen / Refund {bedrag} → `returnActions.setStatus` + toast.

### `/locations`
- Card-click of "Bewerken"-knop → drawer met edit-form (naam/code/type/prio/adres/notitie/active).
- "+ Nieuwe locatie"-drawer met form → `locationActions.add` + toast.
- Active-pill is button: toggle → `toggleActive` + toast.

### `/purchase-orders`
- Status-tabs + supplier-dropdown filteren live.
- Row-click → 620px-drawer met:
  - Items-tabel met per-regel `<input>` + boek-button (`receiveLine` + toast).
  - "Markeer verzonden"-knop (draft/sent → sent + toast).
  - "Volledig ontvangen"-knop (loop alle lines, set received_qty=ordered_qty + toast).
  - "Annuleer PO" → ConfirmDialog → cancelled + toast.
- "+ Nieuwe PO"-drawer met supplier-select / # regels / aantal/regel / prijs/st / verwacht over X dagen → `poActions.add(po, lines)` + toast.

### `/suppliers`
- Card-button "Bewerken" → drawer met edit-form (naam/contact/email/telefoon/adres/category/lead-time/payment/active/notes).
- Active-pill is button: toggle.
- "+ Leverancier toevoegen"-drawer.
- "Nieuwe PO" → toast.info + navigate naar `/purchase-orders`.

### `/channels`
- Per kanaal "Configureren"-knop → drawer met kanaal-specifieke config:
  - **GMC**: feed-URL, refresh-interval (min), doelland, BTW-mode.
  - **Bol**: client-id, client-secret (password), FBR/FBB segmented-toggle, auto-fulfill checkbox.
  - **Amazon**: refresh-token (password), marketplace-id, VCS-mode.
  - **Storefronts**: api-token-show/regenerate, allowed-origins, webhook-URL.
  - Submit → `channelActions.saveConfig` + toast.
- "Sync nu"-knop → 900ms loading-state met spinner → `setLastSync` + toast met "X producten gesynced".
- Active-pill is button: toggle pause/connected.
- "Kanaal toevoegen" + dashed-add-card → `toast.info "Fase 3"`.

### `/channels/matrix`
- Search debounced + "Alleen live"-checkbox + channel-dropdown.
- Toggle-cel: `matrixActions.toggleCell` (silent als disable, toast als enable).
- "Bulk-actie"-dropdown: per kanaal "Activeer alle" / "Deactiveer alle" → `bulkSetForChannel` + toast.

### `/finance`
- Period-picker (Mei/Q2/Jaar/Custom) — schaalt KPI's met factor (visueel).
- Export-knoppen: UBL/OSS-CSV/ICP-CSV/Push naar Moneybird → 700ms loading → toast met file-pad.
- "Boekhouding"-link werkt al.

### `/accounting`
- "Koppelen"-knop → ConfirmDialog → 800ms → `accountingActions.connect` + toast.
- "Sync nu"-knop → 700ms loading → toast.
- "Download"-knop → toast.
- "Export now"-knop → 700ms → toast.

### `/ledger`
- Search debounced + account-dropdown + channel-dropdown.
- Saldo-cards klikbaar → filter op dat account.
- Row-click → modal met details.
- "Wis filters"-knop reset alles.
- "Export CSV"-knop → toast met file-pad + record-count.

### `/settings`
- Werkende logout (al via Aether's `useLogout`).

### `/settings/users`
- Row-click → drawer (edit).
- Action-menu (`MoreHorizontal`): Bewerken / Activeren-Deactiveren / Verwijderen (ConfirmDialog).
- "+ Gebruiker uitnodigen"-drawer met naam/email/role/2FA-checkbox → `userActions.add` + toast.

### `/settings/tokens`
- "+ Nieuwe token" → modal met label/scope/scope-detail → genereer fake token → tweede modal `lockBackdrop` toont volledige token één keer met copy-knop → close = nooit meer zichtbaar.
- "Kopieer prefix" → navigator.clipboard + toast.
- "Intrekken" → ConfirmDialog → `tokenActions.revoke` + toast.

### `/settings/webhooks`
- Row-click → drawer (edit).
- Action-menu: Bewerken / Activeren-Deactiveren / Verwijderen.
- "Test ping"-knop → 700ms loading → toast (90% success / 10% error voor realisme).
- "+ Webhook toevoegen"-drawer met URL / beschrijving / events-multi-toggle (8 event-types) / active.

### `/products`, `/products/$id`, `/products/new`, `/stock`, `/stock/$itemId`, `/movements`
Door **Aether** al volledig gepolished+functioneel gemaakt in design-pass. Niet aangeraakt — werkt:
- Producten: Cards/Tabel-toggle, search, status-tabs, click-naar-detail.
- Product-detail: sticky save-bar (Ctrl+S), confirm-archive modal.
- Stock: KPI-strip, filters, adjust-modal.
- Movements: tabel/tijdlijn-toggle, filters.

## Acceptance-checklist

- [x] **Login-form werkt** in DEMO_MODE (demo-creds + submit → 800ms → dashboard, "Onthouden" persisteert).
- [x] **Dashboard quick-actions** geven feedback (toast of navigate, GMC + Moneybird met loading-state).
- [x] **Producten** cards-click → detail (Aether).
- [x] **Orders** row-click → detail, "+ Handmatige order"-drawer opent + submit werkt + nieuwe row verschijnt.
- [x] **Orders detail**: status-stappen klikbaar, label/refund/cancel modals, advance-knop.
- [x] **Klanten** row-click → drawer (info + recente orders).
- [x] **Retouren** row-click → drawer (approve/reject/receive/refund-actions).
- [x] **Locaties** card-click → edit-drawer; active-pill toggle werkt.
- [x] **PO's** row-click → drawer met receive-flow (qty-input + boek-button), markeer-verzonden, volledig-ontvangen, annuleer.
- [x] **Leveranciers** card-button → drawer (edit + create); active-pill toggle.
- [x] **Channels** "Configureren" → drawer per kanaal-type met juiste config-velden.
- [x] **Channels matrix** toggle → optimistic update + toast (silent on disable, message on enable); bulk-acties per kanaal.
- [x] **Finance** period-picker werkt + 4 export-knoppen geven toast met realistische file-paden.
- [x] **Settings-tabs** switchen tussen Algemeen/Users/Tokens/Webhooks via TanStack Link `data-active`.
- [x] **Toast** verschijnt + verdwijnt op alle acties (2.6s auto-dismiss).
- [x] **Filter-state** in alle lijsten werkt; **search debounced** (250-300ms).
- [x] **ESC + backdrop-click** sluiten alle drawers/modals (lockBackdrop alleen op show-token-once-modal).
- [x] **localStorage-persistence** voor mutaties — survival na refresh.

## Wat is "Coming in Fase X"-stub

| Knop | Toast |
|---|---|
| Order: Print factuur | "Factuur-printen komt in Fase 4" |
| Order: Pak-bon | "Pak-bon-print komt in Fase 4" |
| Klant: Bewerken | "Klant-bewerken komt in Fase 2" |
| Channels: + Kanaal toevoegen | "Komt in Fase 3 (vereist adapter-implementatie)" |

## Wat operator moet weten

1. **DEMO_MODE login-flow**: `_app.tsx` auto-seedt mock-user als de operator direct naar `/` gaat. Maar als operator op `/login` zit, **moet** je submit klikken. De redirect-on-loaded is verwijderd uit login.tsx (anders kun je geen demo-flow zien).

2. **Mutaties persistent**: Refresh = behoud van handmatig aangemaakte order/klant/PO/etc. Wis via DevTools `localStorage.removeItem('webshop-crm:mock-state:v1')` of via `resetMockState()` in console.

3. **TS errors**: 4 pre-existing TS-errors (VariantForm + ImageUploader + products.new) blijven over. Vite runtime is OK; build is groen. Niet door deze pass geïntroduceerd.

4. **PO-line-items zijn synthetisch**: het mock-data-extended PO-model heeft alleen aggregates (`itemsCount`, `orderedQty`, `receivedQty`). De receive-flow werkt op gegenereerde line-items per PO, opgeslagen in `state.poLines` met dezelfde persistence.

5. **Channel matrix-cellen** zijn agnostisch over wat de UI showt — de achterliggende mock-data heeft al alle 30 producten × 5 kanalen, dus toggles updates blijven zichtbaar.

## Open issues / TODOs

- **Dashboard "+ Voorraad-mutatie"**: nog niet als quick-action — operator gaat naar `/stock` en gebruikt Aether's adjust-modal. Zou met deeplink kunnen (`/stock?adjust=open`) maar dat vereist coupling met Aether's stock-page state.
- **Customer-detail page**: drawer biedt info-overview, maar geen full page. Klant-bewerken stub.
- **Order create-form**: minimal viable (1 SKU/qty/unitPrice). Multi-line + product-picker is V2.
- **Settings-tabs animatie**: TanStack `Link` met `data-active`-prop werkt — maar de active-state komt uit een prop niet uit URL. Dat is opzettelijk omdat verschillende tab-pages elk hun eigen `active=` doorgeven.
- **Sidebar**: niet aangeraakt. Operator kan via direct-URL naar /channels/matrix en /accounting; sidebar-wiring zit in `REGISTER-SIDEBAR.md` van Aether (nog niet uitgevoerd).
- **Toast-spam**: bij rapid bulk-toggle in matrix krijg je veel toasts. Bulk-acties in dropdown laten 1 sammelende toast zien; individuele cel-toggles alleen bij enable.

## Backups

`.pre-interaction.bak` op alle 16 aangepaste page-files:
```
src/routes/_app/orders.tsx
src/routes/_app/orders.$id.tsx
src/routes/_app/customers.tsx
src/routes/_app/returns.tsx
src/routes/_app/locations.tsx
src/routes/_app/purchase-orders.tsx
src/routes/_app/suppliers.tsx
src/routes/_app/channels.tsx
src/routes/_app/channels.matrix.tsx
src/routes/_app/finance.tsx
src/routes/_app/accounting.tsx
src/routes/_app/ledger.tsx
src/routes/_app/settings.users.tsx
src/routes/_app/settings.tokens.tsx
src/routes/_app/settings.webhooks.tsx
src/routes/_app/index.tsx
```

`/login.tsx` en `/lib/auth.ts` hebben alleen kleine demo-mode-tweaks gekregen (inline gedocumenteerd) — geen .bak nodig.

Rollback per file:
```powershell
Copy-Item .\src\routes\_app\orders.tsx.pre-interaction.bak .\src\routes\_app\orders.tsx -Force
```

## Geen nieuwe deps

`useSyncExternalStore` zit in React 18+. Geen Zustand/Jotai toegevoegd. Pure CSS via Aether's bestaande utility-classes.
