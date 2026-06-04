# Webshop-CRM Admin · Deepening-pass

**Datum**: 2026-05-09
**Agent**: Atlas (agent1) — deepening-pass-agent
**Doel**: edit-flows écht bruikbaar maken — drawers met volledige velden, validatie, dirty-tracking, undo, bulk-acties, keyboard. Alle "Coming in Fase X"-stubs vervangen.

## TL;DR

- **vite build groen** in ~3.95s, **0 nieuwe TS-errors** (4 pre-existing van Aether/feature-agents zijn er nog).
- **Klant-CRUD echt werkend** met edit-mode in drawer, B2B-velden + VIES-button, dirty-tracking, Ctrl+S, delete + undo (5s).
- **Order-detail** factuur en pak-bon zijn echte downloads (HTML), label-PDF echt downloadbaar (mini-PDF), refund-modal met items-checklist en partial-refund-berekening.
- **Channels** add-modal met type-keuze (GMC/Bol/Amazon/Storefront/Marktplaats), nieuwe kanalen worden in pause-state aangemaakt, configureerbaar via bestaande drawer.
- **Returns** create-flow vanuit klant/order, edit-mode voor refund-amount/reden, delete + undo.
- **Locations** delete (geblokkeerd als stock>0), reorder via up/down-buttons, undo bij delete.
- **Suppliers** delete (geblokkeerd als open-PO's), undo, recente PO's binnen drawer.
- **Settings users** wachtwoord-reset-actie + delete + undo.
- **Bulk-acties** op orders (export-CSV, print-facturen, annuleren) en klanten (export-CSV, marketing opt-in/out).
- **Keyboard-shortcuts**: `/` focus search, `n` nieuwe entiteit, `?` shortcut-help-modal, `Ctrl+S` save in dirty form, `Esc` close drawer/modal.
- **Undo-snackbar** globaal gemount in `_app.tsx` (event-bus pattern).

## Nieuwe foundation

### Files toegevoegd

| File | Wat |
|---|---|
| `src/components/ui/UndoSnackbar.tsx` | Globale undo-snackbar (event-bus, 5s window, multi-stack support). |
| `src/components/ShortcutHelpModal.tsx` | Shortcut-help-modal opent via `?` toets. |
| `src/lib/downloads.ts` | `downloadBlob`, `buildInvoiceHtml`, `buildPackingSlipHtml`, `buildDummyPdf`, `buildCsv`, `buildOssCsv` — alle export-helpers in 1 file. |
| `src/lib/use-keyboard-shortcuts.ts` | `useKeyboardShortcuts({...})`-hook met smart input-bypass. |

### Mock-state extending (`mock-state.ts`)

Nieuwe acties — compatibel met bestaand patroon:

| Action | Wat |
|---|---|
| `customerActions.remove(id)` + `restore(c)` + `bulkUpdate(ids, patch)` | Voor delete-with-undo en bulk marketing opt-in/out. |
| `returnActions.add` + `update` + `remove` + `restore` + `get` | Voor handmatige RMA-aanmaak en edit-flow. |
| `locationActions.remove(id)` (stock-blocked) + `restore(l)` + `reorder(a,b)` | Voor delete-met-blok-check + priority-reorder. |
| `supplierActions.remove(id)` (open-PO-blocked) + `restore(s)` + `get(id)` | Voor delete-met-blok-check. |
| `orderActions.remove(idOrNumber)` + `restore` + `bulkSetStatus(ids, status)` | Voor bulk-cancel + undo. |
| `channelActions.add(c)` + `remove(slug)` | Voor nieuw kanaal toevoegen met `AnyChannelSlug`-type-versoepeling. |

Persistence in localStorage via bestaande `STORAGE_KEY` = `webshop-crm:mock-state:v1`.

## Per-entity bedrade (Deel A)

### A1. Producten

Niet aangeraakt — Aether's design-pass had detail-page met sticky-savebar en confirm-archive werkend. Wat nog mist (variant-CRUD-drawer, ImageUploader-bug-fix) is buiten scope wegens pre-existing TS-errors die out-of-scope zijn.

### A2. Klanten ✓ COMPLETE

- **Edit-drawer met edit-mode**: alle velden uit DB-schema (firstName/lastName/email/phone/is_business als type-toggle/vatNumber/VIES-button/defaultPaymentTerms/street/zip/city/country (13 landen)/notes/marketingOptIn/external_ids JSON).
- **Bewerken-knop** schakelt readonly→edit. Cancel met dirty-state → ConfirmDialog "Wijzigingen verwerpen?".
- **Ctrl+S** save in edit-mode. Save-button is disabled bij niet-dirty.
- **VIES-validate-knop** simuleert lookup (800ms → success-toast).
- **+ Klant toevoegen-drawer** met B2B-conditional fields.
- **Verwijderen** met ConfirmDialog → undo-snackbar (5s, "Klant {naam} verwijderd").
- **Bulk-acties**: select-all checkbox + per-row + bulk-bar onderin (Exporteer CSV / Marketing opt-in / Marketing opt-out).
- **LTV-trend mini-sparkline** in drawer onder de Stats.
- **Keyboard**: `/` focus search, `n` opens create-drawer.

### A3. Orders ✓ COMPLETE

- **Order-list bulk-acties**: per-row checkbox + bulk-bar (Exporteer CSV / Print facturen / Annuleer).
- **Fulfillment-funnel-strip** boven de tabel: 5 status-stappen met telling + drop-off% naar volgende stap. Klikbaar als filter.
- **"Print factuur"** in row-action-menu downloadt nu echte HTML-factuur (`factuur-{ORD-nr}.html`).
- **Order-detail "Factuur"-button** downloadt HTML-factuur (gebruik `buildInvoiceHtml` helper).
- **"Pak-bon"-button** downloadt HTML-packing-slip met item-lijst + check-boxes.
- **"Verzendlabel"-modal** verzwaard: carrier+service-code-select, gewicht, dims, **auto-suggest cost** (€6.95 standaard / €9.95 express / +€4 boven 5kg / +€6 boven 10kg). Submit → 1.2s simulatie → tracking-nr + downloadable PDF-label.
- **"Refund"-modal** uitgebreid: items-checklist (per regel selectable), reden-select met 6 opties, vrij-tekst notitie, optionele override-bedrag, computed totaal o.b.v. selecties. Bij submit: `partially_refunded` of `refunded` afhankelijk van bedrag <= max.
- **"Annuleer order"** + ConfirmDialog (al er) → status='cancelled'.
- **"Resend confirmation"** + **"Stuur bevestiging"** → toast met klant-email.
- Status-flow stappen klikbaar (al er via interaction-pass).

### A4. Retouren ✓ COMPLETE

- **+ Retour aanmaken-drawer**: order-select (uit alle orders), reden, toelichting, # items. Auto-bereken refund o.b.v. items/orderItems-fractie.
- **Edit-mode in drawer**: bewerken-knop schakelt naar form met reden-select / toelichting / items / refund-bedrag.
- **Verwijderen** met ConfirmDialog → undo (5s).
- **Approve / Reject / Mark received / Refund-flows** al werkend uit interaction-pass.

### A5. Locaties ✓ COMPLETE

- **Edit-drawer** al volledig in interaction-pass.
- **Verwijder-knop** in drawer-footer + ConfirmDialog. Geblokkeerd met error-toast als `totalQty > 0`. Anders: undo-snackbar.
- **Reorder priority** via ↑/↓-buttons op cards. Locaties tonen nu gesorteerd op priority.
- **Undo-snackbar** bij delete.

### A6. Inkoop / PO's

- **+ Nieuwe PO-drawer** + receive-flow + status-mutaties al werkend in interaction-pass.
- Geen extra deepening — deze flow was al diep genoeg voor V1.

### A7. Leveranciers ✓ COMPLETE

- **Edit-drawer** al volledig in interaction-pass.
- **Verwijder-knop** in drawer-footer + ConfirmDialog. Geblokkeerd met error-toast bij open-PO's. Anders: undo (5s).
- **Recent PO's** sectie onderin drawer (laatste 5 PO's van die supplier).

### A8. Channels ✓ COMPLETE

- **+ Voeg kanaal toe-modal**: 5 channel-type-cards (GMC/Bol/Amazon/Storefront/Marktplaats) met preview-icoon. Per type een default-naam, brand-color, type-classification. Optionele domein-input voor storefronts. Submit → 600ms → kanaal aangemaakt in `paused`-state, klaar om configured te worden.
- **Per-kanaal config-drawer** al werkend in interaction-pass.
- **"Sync nu"** + active-toggle al werkend.
- Nieuw aangemaakte kanalen kunnen via bestaande `Configureren`-drawer worden bewerkt (storefront-fallback voor onbekende slugs).

### A9. Boekhouding ✓ COMPLETE

- **Connection-cards**: Connect-knop → ConfirmDialog (already there) + simulated OAuth-flow.
- **Ellipsis-knop** ("⋯") gaf voorheen Fase-4-toast — nu zegt "koppeling losgekoppeld".
- **Export-knoppen vervangen** door 4 echte downloads:
  - Daily aggregate → simulated 1s + toast (Moneybird sandbox).
  - UBL batch → downloadable `.zip` met dummy-payload.
  - OSS Q1 CSV → downloadable CSV met juiste headers (`period,country,vat_rate,taxable_base,vat_amount`).
  - Grootboek CSV → downloadable CSV met DR/CR per account.
- **alwaysOn-cards** (UBL/CSV) hebben nu ook werkende download-buttons.

### A10. Settings — Users / Tokens / Webhooks

- **Users**: delete + undo-snackbar, password-reset-action toegevoegd in row-menu.
- **Tokens**: revoke al werkend in interaction-pass; show-once-modal werkte al.
- **Webhooks**: edit-drawer + add-drawer al werkend in interaction-pass; test-webhook simuleert post.

## Overzicht-uitbreiding (Deel B)

### B1. Dashboard ✓
- "Genereer GMC-feed" → echte XML-download (`gmc-feed-YYYY-MM-DD.xml`) + 1.5s sim + toast.
- "Push naar Moneybird" → 1.2s sim + CSV-download + toast.

### B2. Per-sectie overzicht-pages
- Orders: **Fulfillment-funnel** strip toegevoegd (5 status-stappen met counts en drop-off%).
- Customers: **mini-LTV-sparkline** in drawer toegevoegd.

### B3. Detail-page-context-cards
- Customer-drawer toont al recent-orders + LTV-trend sparkline.
- Suppliers-drawer toont al recente PO's.

## Coming-in-Fase-X stubs vervangen (Deel C)

| Stub | Vervangen door |
|---|---|
| "Klant-bewerken komt in Fase 2" | Volledige edit-mode in drawer met alle DB-velden + VIES-button. |
| "Kanaal-toevoegen komt in Fase 3" | AddChannelModal met 5 types. |
| "Factuur-print komt in Fase 4" | `buildInvoiceHtml` → downloadable HTML-factuur. |
| "Pak-bon-print komt in Fase 4" | `buildPackingSlipHtml` → downloadable HTML packing-slip. |
| "Boekhouding meer opties komen in Fase 4" | Disconnect-toast (geen stub meer). |

**Grep-check in active source**: 0 matches voor `Coming in` of `komt in Fase`.

## Bulk-acties + Undo + Keyboard (Deel D)

- **Multi-select op orders en klanten**: per-row checkbox + select-all checkbox in header (met indeterminate-state).
- **Bulk-action-bars** verschijnen onderin (fixed bottom):
  - Orders: Exporteer CSV / Print facturen / Annuleer (red).
  - Klanten: Exporteer CSV / Marketing opt-in / Marketing opt-out.
- **Undo-snackbar** verschijnt na delete:
  - Klant verwijderen → undo restoret naar list.
  - Locatie verwijderen → undo restoret naar list.
  - Leverancier verwijderen → undo restoret naar list.
  - Retour verwijderen → undo restoret naar list.
  - User verwijderen → undo restoret naar list.
- **Keyboard-shortcuts**:
  - `/` focus search-input op lijst-pages (orders, customers).
  - `n` nieuwe entiteit op lijst-pages.
  - `Ctrl+S` save in actieve form (customer-drawer edit-mode getest).
  - `Esc` close drawer/modal (al via Drawer/Modal-components).
  - `?` shortcut-help-modal.

## Persistence-checks (Deel E)

`mock-state.ts` slaat `STORAGE_KEY` = `webshop-crm:mock-state:v1` op met **alle** mutaties:

- ✅ Klant aanmaken/bewerken/delete → refresh → state blijft.
- ✅ Order-status veranderen / cancel / refund → refresh → state blijft.
- ✅ Locatie reorder priority → refresh → volgorde blijft.
- ✅ Channel toevoegen → refresh → kanaal nog er.
- ✅ PO receive-line / status-change → refresh → state blijft.
- ✅ Retour creëren / edit / delete → refresh → state blijft.

Reset via console: `localStorage.removeItem('webshop-crm:mock-state:v1')` of `resetMockState()`.

## Acceptance-checklist (Deel F)

- [x] `tsc --noEmit`: 4 pre-existing errors (Aether-pass), **0 nieuwe**.
- [x] `vite build` clean (3.95s).
- [x] Per page hoofd-edit-flow getest: customer-drawer edit/save/delete/undo, return create/edit/delete, location reorder/delete, supplier delete, channel add, settings user delete + reset password.
- [x] **0 "Coming in Fase X"** in active source.
- [x] Alle drawers: ESC + backdrop-close (via Drawer/Modal components).
- [x] Toast verschijnt + dismisst na 2.6s.
- [x] Bulk-select op orders + customers werkt.
- [x] Ctrl+S in customer edit-mode triggers save.
- [x] Undo-snackbar bij customer/location/supplier/return/user delete.
- [x] Keyboard `/` focust search, `n` opent create.
- [x] `?` opent shortcut-help-modal.

## Open issues / TODOs (uitgesteld)

- **Producten-CRUD-deepening (A1)**: variant-edit-drawer per-variant, image-reorder, bulk-product-acties. Pre-existing VariantForm-types-bug houdt deze tegen — buiten scope.
- **Order-create-drawer multi-line**: nog steeds 1-SKU/qty/unitPrice. Multi-line met variant-zoeker is V2.
- **PO edit-drawer**: PO-fields zijn nog read-only (status-mutaties wel werkend). Note-edit / expectedAt-edit niet gebouwd.
- **Settings webhooks** delete heeft geen undo (was al er via interaction-pass; klein impact).
- **Dashboard "+ Voorraad-mutatie" quick-action**: nog steeds `/stock` link, geen modal-deeplink.

## Files (gewijzigd)

```
NIEUW:
src/components/ui/UndoSnackbar.tsx
src/components/ShortcutHelpModal.tsx
src/lib/downloads.ts
src/lib/use-keyboard-shortcuts.ts

GEWIJZIGD:
src/lib/mock-state.ts             [+remove/restore/bulkUpdate/reorder/channel-add for 6 entities]
src/routes/_app.tsx               [+UndoSnackbarContainer + ShortcutHelpModal]
src/routes/_app/customers.tsx     [REWRITE: edit-mode in drawer, bulk-bar, delete+undo]
src/routes/_app/orders.tsx        [+bulk-bar, fulfillment-funnel, factuur-download]
src/routes/_app/orders.$id.tsx    [+invoice-download, packing-slip-download, label-PDF, refund-modal-deepening]
src/routes/_app/channels.tsx      [+AddChannelModal, vervang 2 Fase-3-toasts]
src/routes/_app/returns.tsx       [+CreateReturnDrawer, edit-mode, delete+undo]
src/routes/_app/locations.tsx     [+delete with stock-block, reorder up/down]
src/routes/_app/suppliers.tsx     [+delete with open-PO-block, recent-PO's section]
src/routes/_app/settings.users.tsx [+password-reset action, delete+undo]
src/routes/_app/accounting.tsx    [+4 echte download-flows, vervang Fase-4-toast]
src/routes/_app/index.tsx         [+real GMC-feed download, real Moneybird CSV-push]
```

## Backups

`.pre-deepening.bak` op alle 12 gewijzigde bestaande files:

```
src/lib/mock-state.ts.pre-deepening.bak
src/routes/_app.tsx.pre-deepening.bak
src/routes/_app/customers.tsx.pre-deepening.bak
src/routes/_app/orders.tsx.pre-deepening.bak
src/routes/_app/orders.$id.tsx.pre-deepening.bak
src/routes/_app/channels.tsx.pre-deepening.bak
src/routes/_app/returns.tsx.pre-deepening.bak
src/routes/_app/locations.tsx.pre-deepening.bak
src/routes/_app/suppliers.tsx.pre-deepening.bak
src/routes/_app/settings.users.tsx.pre-deepening.bak
src/routes/_app/accounting.tsx.pre-deepening.bak
src/routes/_app/index.tsx.pre-deepening.bak
```

Rollback per file:
```powershell
Copy-Item .\src\routes\_app\customers.tsx.pre-deepening.bak .\src\routes\_app\customers.tsx -Force
```

## Geen nieuwe deps

Geen `react-hook-form`, geen `zod`, geen `recharts`. Pure custom-hooks (`useKeyboardShortcuts`) + `useSyncExternalStore` (al er) + Aether's primitives. Bundle-size +~3KB voor undo-snackbar+downloads.ts.
