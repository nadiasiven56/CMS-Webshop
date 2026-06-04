# Image-agent — deliverable summary

**Agent**: image-agent (Fase 1, ronde 2)
**Datum**: 2026-05-09
**Status**: ready for finalize

## Acceptance per endpoint

| Endpoint | Status | Notes |
|---|---|---|
| `POST /api/images` (multipart) | ready | accepteert `file` (1..N), `product_id` optioneel, `alt` optioneel; 415 op verkeerd type, 413 boven 10 MB, 400 bij ontbrekende file, 404 als product_id niet bestaat |
| `PATCH /api/images/:id` | ready | alt + position update; 400 zonder changes, 404 onbekende id |
| `DELETE /api/images/:id` | ready | hard-delete DB + best-effort file-delete; idempotent als file al weg is; 404 onbekende id |
| `POST /api/images/reorder/:productId` | ready | bulk-update positions in 1 transactie; valideert dat alle ids bij dit product horen; 400 op vreemde id |

Alle write-routes achter `requireAuth`. Audit-log row geschreven per mutatie.

## Files aangemaakt

### Backend (`apps/api/`)
- `src/lib/storage/interface.ts` — StorageDriver-interface + StorageNotImplementedError
- `src/lib/storage/sanitize.ts` — filename-sanitize + MIME-helpers + key-builder
- `src/lib/storage/local.ts` — LocalDriver (filesystem)
- `src/lib/storage/s3-stub.ts` — V2-extension-point
- `src/lib/storage/index.ts` — factory + test-hook
- `src/lib/storage/sanitize.test.ts` — 4 describe-blocks
- `src/lib/storage/local.test.ts` — driver-IO via tmpdir
- `src/domain/images/validate.ts` — content-type + size-check
- `src/domain/images/register-product-image.ts` — DB-insert helper met auto-position
- `src/domain/images/validate.test.ts`
- `src/routes/images/index.ts` — Hono-router (POST/PATCH/DELETE/reorder)
- `src/routes/images/__tests__/upload.test.ts` — 7 cases (happy path + 415 + 413 + 400 + 404 + cleanup-on-failure)
- `src/routes/images/__tests__/delete.test.ts` — 4 cases (happy + 404 + 400 + storage-fails-still-200)
- `src/routes/images/__tests__/reorder.test.ts` — 5 cases
- `src/routes/images/__tests__/helpers.test.ts` — deriveKeyFromUrl
- `src/routes/images/REGISTER.md` — voor finalizer (1-regel-wirings)

### Admin (`apps/admin/`)
- `src/components/ImageUploader.tsx` — drag-drop component met progress, preview, reorder, alt-input, delete
- `src/components/image/ImageThumbnail.tsx` — preview-tile met confirm-delete
- `src/components/image/UploadProgressBar.tsx` — per-file voortgangsbalk

### Shared (`packages/shared/`)
- `src/api/images.ts` — zod-schemas (ProductImage, ImageUploadResponse, ImagePatch, ImageReorder + constants)
- `src/index.ts` — re-export `Images` namespace toegevoegd (1 regel)

## Storage-driver pattern (V2-extension)

V1 = `LocalDriver` (filesystem onder `STORAGE_LOCAL_PATH`).
V2-swap is 1 file:

1. Implementeer `S3Driver implements StorageDriver` (vervang `s3-stub.ts`).
2. `STORAGE_DRIVER=s3` + S3-env-vars (`S3_BUCKET`, `S3_REGION`, etc.) in `.env`.
3. Geen routes / domain-code wijzigt: alles gaat door `getStorage()`.

**Belangrijke detail voor V2-S3-migratie**: V1 derivet de `key` uit de
`url`-kolom in DB (heuristiek `slice na /storage/`). Dat werkt voor
local-driver maar wordt fragiel zodra URLs door een CDN-prefix lopen. V2
**MUST**: voeg een kolom `storage_key text not null` toe aan `product_images`
en bewaar key apart van url. Image-agent heeft dit bewust NIET gedaan in
V1 om geen wijziging in foundation-schema af te dwingen — schema-mutatie
hoort bij Atlas / een dedicated migration-agent.

## Open TODO's / V2-followups

- [ ] **`storage_key` kolom toevoegen aan `product_images`** — zie boven; nodig
      voor robuste delete-flow in cloud-storage.
- [ ] **Image-resize / thumbnails** — V2 BullMQ-job die bij upload variants
      genereert (320w / 640w / 1280w). Domein-folder `domain/images/` is al
      voorbereid voor deze logic.
- [ ] **Streaming-uploads voor grote files** — V1 leest hele body in-memory
      (Hono `parseBody`). Bij upload-limiet >> 10 MB straks vervangen door
      streaming-multer-equivalent.
- [ ] **Crop-UI** — geen V1 scope.
- [ ] **Bulk-paste-from-clipboard** — geen V1 scope.
- [ ] **CDN-cache-invalidation** — niet relevant in V1 (geen CDN). V2: on
      delete invalidate cache-tag.
- [ ] **Vitest**: routes-tests gebruiken handgeschreven module-mocks omdat we
      geen Postgres-testcontainer aanzetten in V1. Bij Fase 2 → testcontainer
      met echte DB voor 1 happy-path per route.

## Dependencies toegevoegd

**Geen.** ImageUploader gebruikt HTML5 native drag-drop (geen `react-dropzone`).
`@hono/node-server` (waar `serve-static` uit komt) was al in `apps/api/package.json`.

## Constraints / valkuilen die onderzocht zijn

- **Path-traversal**: filename-input wordt 100% door `sanitizeFilenameStem`
  gehaald. LocalDriver verifieert ook dat de absolute resolve binnen `root`
  blijft (defense-in-depth).
- **Size-cap**: 10 MB hard cap. Hono `parseBody` heeft geen built-in limit
  flag in deze versie; we vangen oversize op via `f.size` post-parse.
  V2-followup als operator wil overriden via `STORAGE_MAX_IMAGE_BYTES` env.
- **Multipart**: V1 in-memory parse via `c.req.parseBody({ all: true })`.
  OK voor 10 MB × N files in dev. Productie-tuning V2.
- **Storage path**: 100% via env (`STORAGE_LOCAL_PATH`); LocalDriver resolved
  relatief tot `process.cwd()` (typisch `apps/api/`). Static-serve in
  `index.ts` (REGISTER.md regel 2) gebruikt `root: './'` dus ook relatief
  tot CWD — 1 single source of truth.
- **Storage-cleanup volgorde**:
  - DELETE: DB-row eerst, file daarna. File-delete-fail = warning + 200.
    DB blijft consistent; verloren file is acceptable orphan.
  - UPLOAD: bij DB-insert-failure rollen we de file-write terug
    (`storage.delete()`). Bij batch-upload met N files, als file 3 faalt
    rollen we file 1+2 ook terug.
- **Idempotency**: globale middleware werkt automatisch op POST. Client-side
  axios-interceptor in `lib/api.ts` zet de header al automatisch.
- **Static-serve route-conflict**: door `app.use('/storage/*', ...)` boven
  `app.route('/api', ...)` te plaatsen vermijden we dat de Hono not-found
  catch-all `/storage/*` opvangt. Documented in REGISTER.md.

## Blockers / dependencies op andere agents

**Geen blockers**. Image-agent is volledig zelfstandig leverbaar.

Wel: product-agent (parallel ronde 2) gaat `<ImageUploader />` importeren
in `routes/_app/products.tsx`. Image-agent levert het component op een
stabiele export-path:

```tsx
import { ImageUploader, type ProductImage } from '@/components/ImageUploader';
```

Of in shared types:

```ts
import { Images } from '@webshop-crm/shared';
type Img = Images.ProductImage;
```

## How to verify (post-finalize)

```sh
# Tests
pnpm --filter @webshop-crm/api test  -- src/lib/storage src/domain/images src/routes/images

# Smoke-test (na finalize wirings + db running)
pnpm dev
# Login admin → naar /products → (na product-agent merge) zie ImageUploader,
# sleep een JPG → zie thumbnail + URL onder /storage/images/products/<id>/...
```
