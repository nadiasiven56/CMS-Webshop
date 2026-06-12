# REGISTER — cms

CMS-module (Wave 1, Agent 2). Strikt binnen `apps/api/src/routes/cms/`.
Geen schema-changes, geen edits buiten deze folder. Finalizer (Atlas) wiret.

## Mount (Atlas voegt toe aan `routes/index.ts`)

```ts
// — bovenin bij de andere feature-imports —
import { cmsRoutes } from './cms/index.js';

// — in de "Feature-agent registration slot" —
apiRoutes.route('/cms', cmsRoutes);
```

`cmsRoutes` zet zelf `requireAuth` op `*`, dus geen extra middleware nodig.

## Endpoints (alle achter `requireAuth`, shop-scoped via `?shop=<slug|id>` of `X-Shop-Id`)

Shop-resolutie: query `?shop=` of header `X-Shop-Id` (slug óf uuid). Bij write
mag de shop ook in de body als `shopId`. Ontbreekt de shop → `400 shop_required`;
onbekende shop → `404 shop_not_found`.

### Pages — `cms_pages` (page-builder, blocks jsonb-array, seo jsonb, UNIQUE(shop_id,slug))
| Method | Path | Noot |
|---|---|---|
| GET | `/api/cms/pages` | filter `status`/`search`, paginate `limit`/`offset` |
| GET | `/api/cms/pages/:id` | |
| POST | `/api/cms/pages` | slug auto uit title; dup-slug → `409 slug_conflict` |
| PATCH | `/api/cms/pages/:id` | |
| DELETE | `/api/cms/pages/:id` | hard-delete |

### Blocks — `cms_blocks` (herbruikbare secties, UNIQUE(shop_id,key))
| GET | `/api/cms/blocks` | filter `type`/`active` |
| GET | `/api/cms/blocks/:id` | |
| POST | `/api/cms/blocks` | dup-key → `409 key_conflict` |
| PATCH | `/api/cms/blocks/:id` | |
| DELETE | `/api/cms/blocks/:id` | |

### Menus + items — `cms_menus` + `cms_menu_items` (self-nesting, UNIQUE(shop_id,location,name))
| GET | `/api/cms/menus` | filter `location` |
| GET | `/api/cms/menus/:id` | **geneste item-boom** (op `position`) |
| POST | `/api/cms/menus` | dup → `409 menu_conflict` |
| PATCH | `/api/cms/menus/:id` | |
| DELETE | `/api/cms/menus/:id` | cascade → items weg |
| POST | `/api/cms/menus/:id/items` | `parentId` voor nesting; self/cross-menu parent → `400 invalid_parent` |
| PATCH | `/api/cms/menus/:id/items/:itemId` | |
| DELETE | `/api/cms/menus/:id/items/:itemId` | children worden via FK `set null` losgekoppeld (worden roots) |
| PUT | `/api/cms/menus/:id/items` | **bulk-replace/reorder** hele menu; nesting via `ref`/`parentRef` in payload |

### Blog — `blog_posts` (UNIQUE(shop_id,slug))
| GET | `/api/cms/blog` | filter `status`/`tag`/`search`, paginate |
| GET | `/api/cms/blog/:id` | |
| POST | `/api/cms/blog` | slug auto uit title; dup → `409 slug_conflict` |
| PATCH | `/api/cms/blog/:id` | |
| DELETE | `/api/cms/blog/:id` | |

> `tag`-filter gebruikt `tags @> ARRAY[$tag]::text[]` (kolom-operator, GEEN
> postgres-js `= ANY($jsArray)` → vermijdt de bekende Fase-1-bug).

### Media — `cms_media` (media-library; `shop_id` nullable = globaal)
| GET | `/api/cms/media` | `scope=shop\|global\|all` (default all), `folder`, paginate. Zonder `?shop=` → alleen globaal |
| POST | `/api/cms/media` | **multipart** (`file`[, `shop`, `folder`, `alt`]) → upload via `lib/storage` LocalDriver; **OF** `application/json` `{url,filename,...}` om bestaande URL te registreren |
| PATCH | `/api/cms/media/:id` | `alt`/`folder` |
| DELETE | `/api/cms/media/:id` | DB-row weg + best-effort storage-delete |

Multipart-allowlist: jpeg/png/webp/gif/svg/avif/pdf, max 20 MB. Storage-key:
`media/<shopId|global>/<folder>/<uuid>-<stem>.<ext>`. URL via dezelfde
`/storage/*` static-serve die de image-agent al heeft laten wiren in `index.ts`
(geen extra static-serve nodig — hergebruikt bestaande LocalDriver + serveStatic).

### Redirects — `cms_redirects` (UNIQUE(shop_id,from_path))
| GET | `/api/cms/redirects` | filter `search` op `from_path` |
| GET | `/api/cms/redirects/:id` | |
| POST | `/api/cms/redirects` | `from_path` genormaliseerd (leading slash, trailing strip); `status_code` 301/302/307/308 (default 301); dup → `409 from_path_conflict` |
| PATCH | `/api/cms/redirects/:id` | |
| DELETE | `/api/cms/redirects/:id` | |

## Multi-user (toegevoegd door Atlas, feat/multi-user)

Shop-resolutie (`_validate.ts: resolveShopId/resolveShopFromRequest`) past nu de
membership-check uit `lib/access.ts` toe: een non-admin die geen member van de
opgegeven shop is krijgt hetzelfde `404 shop_not_found` als bij een onbekende
shop (geen existence-leak). Geldt voor ALLE pages/blocks/menus/blog/redirects-
routes (lists, details én mutaties) en voor shop-scoped media.

Uitzondering `cms_media` met `shop_id NULL` (globaal):
- non-admin mag globale media **lezen** (gedeelde assets, `scope=global`/`all`);
- **muteren/verwijderen** van globale media → `403 forbidden`;
- non-admin **uploads/registraties** vereisen een eigen shop (`400 shop_required`
  zonder shop-ref).

Extra dekking in `src/routes/shops/__tests__/multi-user.real-db.test.ts`
(cms-list-scoping + globale-media-regels).

## Schema-verzoeken (indien kolom mist)

**Geen.** Alle tabellen (`cms_pages`, `cms_blocks`, `cms_menus`,
`cms_menu_items`, `blog_posts`, `cms_media`, `cms_redirects`) bestonden al in
de bevroren migratie `0001_cms_commerce_finance` en zijn 1-op-1 gebruikt.

## Seed/env-verzoeken

**Geen verplicht.** Werkt out-of-the-box met de bestaande `.env`
(`STORAGE_DRIVER=local`, `/storage/*` static-serve).

Optioneel-handig (niet vereist): een demo-shop in de seed zodat de admin-UI
direct content kan tonen. Atlas mag dit toevoegen aan de seed-flow als gewenst;
de CMS-routes werken met élke bestaande shop (resolve op slug of uuid).

## Writes / audit

Alle schrijf-paden (pages/blocks/menus/menu-items/blog/redirects) lopen via
`runInTransactionWithAudit` (`domain/stock/transaction-helpers.js`) → automatische
`audit_log`-rij per mutatie. Media-writes schrijven hun eigen audit-rij
(`entity_type='cms_media'`) omdat ze ook storage-I/O doen buiten de transactie.

`inArray()` gebruikt (NOOIT `= ANY($jsArray)`).

## Tests

- `src/routes/cms/__tests__/cms.integration.test.ts` — **echte DB** (`webshop_crm`
  op :7432). Mockt alleen de auth-middleware. Maakt een wegwerp-shop, exerciseert
  pages → blocks → menus(+nesting+PUT-reorder) → blog(tag-filter) → redirects →
  media(globaal), leest terug, en ruimt op (`DELETE shop` → FK-cascade +
  expliciete media-delete want media hangt niet aan de shop).
  - Skipt zichzelf netjes (geen hard-fail) als de DB onbereikbaar is.

Draaien:
```bash
pnpm -C "C:\ClaudeAgents\shared\from-agent1\webshop-crm" --filter @webshop-crm/api test
# of gericht:
node apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/cms
```
Resultaat hier: **8/8 passed** tegen de live DB, 0 leftover test-data.

> NB. De full-suite toont 12 vooraf-bestaande failures in `products`/`stock`/
> `sanitize` (mock-drift van Fase-1-agents) — niet veroorzaakt door deze module;
> reproduceerbaar zonder de cms-folder.

## Niet gedaan / bewuste keuzes

- `cms` is NIET in `routes/index.ts` gewired (contract: finalizer doet dit).
- Geen frontend/admin-routes (buiten scope).
- Page/blog `blocks`/`seo`/`content` worden als losse jsonb opgeslagen zonder
  diepe block-schema-validatie (V1: vorm-vrij page-builder; valideren we per
  block-type later in Wave 2/3).
