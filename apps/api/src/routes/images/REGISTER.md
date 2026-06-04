# Image-agent — register-instructies voor de finalizer

Dit bestand is door image-agent achtergelaten zodat de finalizer (Atlas) de
juiste 1-regel-wirings in `routes/index.ts` en `index.ts` toevoegt zonder
dat image-agent zelf bestanden buiten zijn scope hoeft aan te raken.

---

## 1. Route-registratie — `apps/api/src/routes/index.ts`

Voeg op de gemarkeerde slot deze regels toe:

```ts
// — bovenin bij de andere imports —
import { imageRoutes } from './images/index.js';

// — onder de auth-route mount, in de gemarkeerde "Feature-agent registration slot" —
apiRoutes.route('/images', imageRoutes);
```

Resulterende endpoints (alle achter `requireAuth`):

| Method | Path                                       | Doel                              |
|--------|--------------------------------------------|-----------------------------------|
| POST   | `/api/images`                              | multipart upload                  |
| PATCH  | `/api/images/:id`                          | alt-text + position update        |
| DELETE | `/api/images/:id`                          | hard-delete (DB + storage)        |
| POST   | `/api/images/reorder/:productId`           | bulk-reorder (in 1 transactie)    |

> NB. Geen overlap met `/api/products` — bewust onder `/api/images` om
> product-agent en image-agent route-namespaces gescheiden te houden.
> Frontend kan straks `POST /api/images/reorder/<productId>` aanroepen
> vanuit de product-detail-page.

---

## 2. Static-serve voor uploaded images — `apps/api/src/index.ts`

In de Hono-app-bootstrap moet de storage-folder publiek serveerbaar zijn,
**boven de globale `app.route('/api', apiRoutes)`** want we willen niet
dat de catch-all 404-handler `/storage/*` opvangt.

Voeg deze regels toe in `apps/api/src/index.ts`:

```ts
import { serveStatic } from '@hono/node-server/serve-static';

// ─── Storage static-serve (lokale image-uploads) ──────────────
// LET OP: pad MOET overeenkomen met env.STORAGE_LOCAL_PATH (default ./storage).
// In V2 (S3) verdwijnt deze handler — files worden dan direct van CDN geserveerd.
app.use(
  '/storage/*',
  serveStatic({
    root: './',                  // process.cwd(); files staan dus in <cwd>/storage/
    rewriteRequestPath: (path) => path, // expliciet identity, voor duidelijkheid
  }),
);
```

Plaats deze blok **net VOOR** `app.route('/api', apiRoutes)`.

### Dependency

`@hono/node-server` is al een dependency in `apps/api/package.json`. De
`serve-static` helper is een sub-export van datzelfde package — geen
extra install nodig.

### Sanity-check na merge

```bash
# 1. Image upload via admin
curl -X POST http://localhost:7300/api/images \
  -F file=@./test.jpg \
  -F product_id=<uuid> \
  -b "webshop_crm_session=<cookie>"
# → 201 + { images: [...] }

# 2. Static-serve werkt
curl -I http://localhost:7300/storage/images/products/<id>/<file>
# → 200 + Content-Type: image/jpeg

# 3. Delete cleant DB en storage
curl -X DELETE http://localhost:7300/api/images/<id> \
  -b "webshop_crm_session=<cookie>"
# → 200 + { ok: true }
```

---

## 3. Geen schema-changes nodig

`apps/api/src/db/schema/product-images.ts` is al door foundation gemaakt —
image-agent heeft die file NIET aangepast. Bestaande migration dekt het.

---

## 4. Geen frontend-route-registratie

Image-agent levert alleen een *component* (`ImageUploader.tsx`) — geen
admin-route. De product-agent importeert die component in
`apps/admin/src/routes/_app/products.tsx` als deel van het product-detail-form.
