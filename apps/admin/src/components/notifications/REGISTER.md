# REGISTER — admin UI: E-mail (`/notifications`) + Kortingen (`/discounts`)

Twee nieuwe admin-features, gebouwd 1-op-1 naar het **channels**-blueprint
(`components/channels/*` + `routes/_app/channels{,.index}.tsx`). Strikt binnen:

- `apps/admin/src/components/notifications/**` (nieuw)
- `apps/admin/src/components/discounts/**` (nieuw)
- `apps/admin/src/routes/_app/notifications.tsx` + `notifications.index.tsx` (nieuw)
- `apps/admin/src/routes/_app/discounts.tsx` + `discounts.index.tsx` (nieuw)

**Niet aangeraakt:** `Sidebar.tsx`, `routeTree.gen.ts`, andere features. De
`routeTree.gen.ts` bevat de twee routes al (auto-gegenereerd door de TanStack
Vite-plugin) — geen handmatige edit nodig.

De **enige** cross-folder wiring die de orchestrator/finalizer moet doen is het
toevoegen van de twee Sidebar-entries hieronder.

---

## 1. Sidebar-entries (orchestrator voegt toe aan `components/Sidebar.tsx`)

### 1a. Icon-imports

`Mail` en `Percent` zijn geldige `lucide-react`-namen en zijn **nog NIET**
geïmporteerd in `Sidebar.tsx`. Voeg ze toe aan het bestaande lucide-import-blok
(bovenin het bestand):

```ts
import {
  // ... bestaande imports ...
  Mail,
  Percent,
} from 'lucide-react';
```

### 1b. Nieuwe secties in de `SECTIONS`-array

Voeg twee nieuwe secties toe. Voorgestelde plaatsing: **"Communicatie"** direct
ná de bestaande `Verkoop`-sectie, en **"Promoties"** direct ná `Communicatie`
(of waar het de operator logisch lijkt). Exact:

```ts
{
  label: 'Communicatie',
  items: [{ label: 'E-mail', to: '/notifications', icon: Mail }],
},
{
  label: 'Promoties',
  items: [{ label: 'Kortingen', to: '/discounts', icon: Percent }],
},
```

Wil je geen nieuwe secties, dan kunnen de items ook in bestaande secties:
`E-mail` past in een `Account`/`Communicatie`-blok, `Kortingen` logisch bij
`Verkoop`. De aanbevolen aanpak zijn de twee aparte secties hierboven.

---

## 2. Endpoints die de UI consumeert (bestaan + zijn gemount)

### Notifications (`/api/notifications/*`)
| Method | Path | Hook |
|---|---|---|
| GET    | `/providers`                     | `useProviders` |
| POST   | `/providers`                     | `useCreateProvider` |
| GET    | `/providers/:id`                 | `useProvider` |
| PATCH  | `/providers/:id`                 | `useUpdateProvider` |
| DELETE | `/providers/:id`                 | `useDeleteProvider` |
| PUT    | `/providers/:id/credentials`     | `useSetProviderCredentials` |
| POST   | `/providers/:id/test-connection` | `useTestProviderConnection` |
| POST   | `/providers/:id/activate`        | `useActivateProvider` |
| GET    | `/templates`                     | `useTemplates` |
| GET    | `/templates/:key`                | `useTemplate` |
| PATCH  | `/templates/:key`                | `usePatchTemplate` |
| POST   | `/test-send`                     | `useTestSend` |
| GET    | `/log?to=&order_id=&limit=&offset=` | `useEmailLog` |

Provider-creds-shapes (encrypted, masked-presence terug): smtp
`{host,port,user,pass,secure}` + config `{fromEmail,fromName,replyTo}`;
postmark `{serverToken}`; sendgrid `{apiKey}`; mailgun `{apiKey}` + config
`{mailgunDomain}`. `test-send` kan `skipped_no_provider` teruggeven — de UI toont
dat als duidelijke hint (geen fout).

### Discounts (`/api/discounts*`)
| Method | Path | Hook |
|---|---|---|
| GET    | `/discounts`                | `useDiscounts` |
| POST   | `/discounts`                | `useCreateDiscount` |
| GET    | `/discounts/:id`            | `useDiscount` |
| PATCH  | `/discounts/:id`            | `useUpdateDiscount` |
| DELETE | `/discounts/:id`            | `useDeleteDiscount` |
| GET    | `/discounts/:id/redemptions`| `useDiscountRedemptions` |
| POST   | `/discounts/validate`       | `useValidateDiscount` |

Status-pill is de door de backend **afgeleide** `status`
(scheduled/active/expired/exhausted/disabled). Geld blijft een Money-STRING.

---

## 3. Geleverde bestanden

```
components/notifications/
  api.ts                    # hooks + DTO's + provider/template-meta (noUncheckedIndexedAccess-safe)
  ProviderStatusPill.tsx    # provider-status + email-log-status pills
  ProviderConfigDrawer.tsx  # per-provider creds + afzender-config + Test + Activeren
  TemplateEditorDrawer.tsx  # subject/bodyHtml/bodyText/enabled + Test-mail sturen
  REGISTER.md               # dit bestand

routes/_app/
  notifications.tsx         # pure <Outlet/>
  notifications.index.tsx   # providers-grid + templates-lijst + e-mail-log

components/discounts/
  api.ts                    # hooks + DTO's + type/status-meta
  DiscountStatusPill.tsx    # afgeleide-status pill
  DiscountDrawer.tsx        # add/edit: alle velden, type stuurt value-weergave
  RedemptionsDrawer.tsx     # per-rij inwisselingen (read-only)
  ValidatePanel.tsx         # "Code testen" → POST /validate (preview)

routes/_app/
  discounts.tsx             # pure <Outlet/>
  discounts.index.tsx       # tabel + drawer + redemptions + validate + delete(ConfirmDialog)
```

## 4. Conventies bevestigd

- Axios `api` uit `@/lib/api`; query-keys met filters; mutations invalideren de
  feature-key. Geld = STRING. Masked creds → "Gezet"/"Niet gezet". Dutch labels.
- Layout-routes pure `<Outlet/>`; index-route-id eindigt op `/`
  (`/_app/notifications/`, `/_app/discounts/`).
- Reuse van `ui/*` (Drawer, Modal, FormField, EmptyState, Skeleton, ConfirmDialog,
  toast). Provider/template/type-meta-maps met veilige accessor-functies i.v.m.
  `noUncheckedIndexedAccess`.
- `DiscountDrawer` gebruikt `useShopList` (bestaand, `components/shops/api.ts`)
  voor de optionele shop-scope-selector. Read-only hergebruik, geen wijziging.

## 5. Typecheck

`pnpm --filter @webshop-crm/admin typecheck` → de 4 pre-bestaande baseline-errors
(ImageUploader.tsx:206, VariantForm.tsx:116 & :229, products.new.tsx:21) blijven.
**ZERO nieuwe errors** uit notifications/discounts.
