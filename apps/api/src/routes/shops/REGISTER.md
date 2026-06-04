# REGISTER — shops

Module: multi-shop tenant-beheer + per-shop product-publicatie + herbruikbare
`shopContext`-resolver. Wave-1 backend-agent 1.

## Mount (Atlas voegt toe aan `apps/api/src/routes/index.ts`)

Import (bij de andere route-imports):

```ts
import { shopsRoutes } from './shops/index.js';
```

Mount (in het feature-agent registration slot):

```ts
apiRoutes.route('/shops', shopsRoutes);
```

Geen verdere wiring nodig. Auth (`requireAuth`) zit al binnen de router
(`shopsRoutes.use('*', requireAuth)`). Idempotency-middleware (global op
`/api/*`) werkt automatisch mee voor de write-endpoints.

## Endpoints (alle achter requireAuth, sessie-cookie)

| Method | Path | Doel |
|---|---|---|
| GET    | `/api/shops` | list — query: `limit` (1..100, def 50), `offset`, `status` (active\|draft\|paused), `search` (name/slug/domain ilike). Resp `{items, total, limit, offset}` |
| POST   | `/api/shops` | create — body: `{slug, name, domain?, locale?, currency?, status?, branding?, vatConfig?, defaultLocationId?, supportEmail?}`. `201 {shop}`. `409 slug_taken` / `409 domain_taken`. |
| GET    | `/api/shops/:id` | detail — `200 {shop}` / `404 not_found` / `400 invalid_id` |
| PATCH  | `/api/shops/:id` | partial update (zelfde velden, alle optioneel, min. 1 vereist). `409` bij slug/domain-clash. |
| DELETE | `/api/shops/:id` | verwijder shop (cascade ruimt `shop_products` + CMS/commerce-kinderen). `200 {ok, id}` |
| GET    | `/api/shops/:id/products` | publicatie-lijst (join met `products`). Query: `publishedOnly=true`. Resp `{shopId, items:[{...shopProduct, product:{id,slug,title,status}}], total}` |
| PUT    | `/api/shops/:id/products/:productId` | upsert publicatie via `shop_products`. Body: `{published?, priceOverride?(string\|null), position?}`. Toggle published zet/clear-t `published_at`. `201` (nieuw) / `200` (update). `404 shop_not_found` / `404 product_not_found`. |

**Geld**: `priceOverride` is een numeric(12,4)-**string** (Money-conventie), nooit
number — in & out.

**Audit**: alle writes (create/update/delete shop, upsert shop_product) lopen via
`runInTransactionWithAudit` → `audit_log`-rij met `entityType` `shop` resp.
`shop_product`.

## `shopContext` — herbruikbare shop-resolver (voor andere modules)

Bestand: `apps/api/src/domain/shops/shop-context.ts`. Resolveert "welke shop"
uit (prioriteit): expliciete optie → `?shop=<slug|id>` → header `X-Shop-Id`.
Een UUID matcht op `shops.id`, anders op `shops.slug`. Zo werkt zowel
`?shop=crema` als `?shop=<uuid>` en `X-Shop-Id: crema`.

### Exports + signaturen

```ts
// Pure DB-lookup (uuid → id, anders → slug). null als niet gevonden.
findShopByIdentifier(identifier: string): Promise<Shop | null>

// Lees de identifier-string uit context (optie → query → header), of null.
readShopIdentifier(c: Context, opts?: { shop?: string | null }): string | null

// Resolveer naar volledige shops-row of null. Geeft GEEN HTTP-response terug;
// caller beslist 400/404. Meest gebruikte helper voor andere modules.
resolveShopContext(c: Context, opts?: { shop?: string | null }): Promise<Shop | null>

// Hono-middleware-variant: zet c.set('shop', shop). required:true (default) →
// 400 shop_required bij ontbrekende identifier, 404 shop_not_found bij onbekend.
// required:false → next() zonder set (c.get('shop') kan undefined zijn).
shopContext(options?: { required?: boolean }): MiddlewareHandler<{ Variables: ShopContextVariables }>

// Helpers
isUuid(v: string | undefined | null): v is string
type ShopContextVariables = { shop: Shop }
```

### Gebruik in een andere module (voorbeeld)

```ts
import { resolveShopContext } from '../../domain/shops/shop-context.js';

cmsRoutes.get('/pages', async (c) => {
  const shop = await resolveShopContext(c);            // ?shop= of X-Shop-Id
  if (!shop) return c.json({ error: 'shop_not_found' }, 404);
  const rows = await db.select().from(cmsPages).where(eq(cmsPages.shopId, shop.id));
  return c.json({ items: rows });
});
```

Of als volledig shop-scoped router:

```ts
import { shopContext, type ShopContextVariables } from '../../domain/shops/shop-context.js';
const r = new Hono<{ Variables: AuthVariables & ShopContextVariables }>();
r.use('*', requireAuth);
r.use('*', shopContext());          // 400/404 zelf; daarna c.get('shop') gegarandeerd
r.get('/pages', (c) => { const shop = c.get('shop'); /* ... */ });
```

## Schema-verzoeken (indien kolom mist)

**Geen.** Module gebruikt uitsluitend de bevroren tabellen `shops` +
`shop_products` exact zoals in `docs/DB-SCHEMA-V2.md` / `db/schema/shops.ts` /
`db/schema/shop-products.ts`. Geen schema-wijziging nodig.

## Seed/env-verzoeken

Geen. (Tip voor demo-data: er zijn nog geen `shops`-rijen geseed — als Atlas
wil kan een demo-shop + een paar `shop_products`-publicaties aan de seed-flow,
maar dat is optioneel en niet vereist voor deze module.)

## Tests

- `src/routes/shops/__tests__/shops.real-db.test.ts` — **echte DB** (geen mocks).
  Mount de router via Hono `app.request()`, maakt een echte sessie voor de
  seed-admin, doet de volledige flow (create → read → list → patch → publish
  demo-product → list-products → publishedOnly-filter → 404-cases → delete) en
  ruimt alles op in `afterAll` (shop-delete cascade + sessie + shop-audit).
- Draaien (hele api-suite):
  `pnpm -C "C:\ClaudeAgents\shared\from-agent1\webshop-crm" --filter @webshop-crm/api test`
- Alleen deze module:
  `pnpm --filter @webshop-crm/api exec vitest run src/routes/shops`
- Resultaat lokaal: **13/13 groen** tegen de echte Postgres op `127.0.0.1:7432`.

### Bekende NIET-shops-failures in de volledige suite
Bij `pnpm ... test` falen 3 bestaande test-files van andere agents
(`lib/storage/sanitize.test.ts`, `routes/products/products.test.ts`,
`routes/stock/adjust.test.ts` — mocked-db tests). Die staan los van deze
module; de shops-tests zijn volledig groen.
