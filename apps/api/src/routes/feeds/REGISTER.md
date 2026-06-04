# REGISTER — feeds + marketing (Atlas, Wave-M)

Marketing product-feeds (Google Shopping XML / Meta catalog CSV) + per-shop
storefront-analytics config. **Eén mount** (`/feeds`) met BÉIDE een authed en
een publieke sub-router. De publieke routes mogen NOOIT achter `requireAuth` —
zie "Auth-structuur" hieronder.

Alle nieuwe files staan onder:
`apps/api/src/routes/feeds/**`, `apps/api/src/domain/feeds/**`,
`apps/api/src/db/schema/marketing.ts`, `apps/api/src/db/seed-marketing.ts`.
Geen andere folder/schema-file/`routes/index.ts`/`seed.ts` aangeraakt.

---

## 1. Mount in `routes/index.ts`

```ts
// import bovenaan (bij de andere Wave-imports):
import { feedsRoutes } from './feeds/index.js';

// in de feature-registration-slot (1 regel, ÉÉN mount):
apiRoutes.route('/feeds', feedsRoutes);
```

### Auth-structuur (waarom 1 mount veilig is)
`feedsRoutes` is een parent-Hono die intern TWEE sub-routers mount:

```ts
feedsRoutes.route('/public', publicRoutes);  // GEEN auth-middleware
feedsRoutes.route('/', authedRoutes);         // authedRoutes.use('*', requireAuth)
```

`requireAuth` hangt **alleen** op `authedRoutes`, NIET op de parent. Daardoor:
- `/api/feeds/public/*` → publiek (geen cookie nodig), net als storefront.
- `/api/feeds/analytics`, `/api/feeds/configs`, `/api/feeds/configs/:id/rebuild`
  → achter `requireAuth`.

Mount dus gewoon één keer op `/feeds`; niets extra nodig in `index.ts`.

---

## 2. Schema-export in `db/schema/index.ts`

Voeg onderaan (na de Channels-sectie) toe:

```ts
// ─── Marketing (feeds + storefront-analytics) ─────────────────
export * from './marketing.js';
```

Exporteert: `storefrontAnalytics`, `feedConfig`, `FEED_CHANNELS` (+ types).

---

## 3. Seed in `db/seed.ts`

```ts
// import bovenaan (bij seedChannels):
import { seedMarketing } from './seed-marketing.js';

// in de seed-flow, NA seedDemoShops / na de shops bestaan (analytics + feed_config
// hangen aan shops; idempotent + tolerant bij 0 shops):
await seedMarketing();
```

> Volgorde: roep `seedMarketing()` aan NADAT shops geseed zijn (anders 0 rows —
> de functie is tolerant en doet dan niks; bij latere re-seed vult ze aan).
> Idempotent via UNIQUE(shop_id) / UNIQUE(shop_id, channel) + `onConflictDoNothing`.

---

## 4. Env (optioneel)

Geen verplichte nieuwe env. De feed-links + publieke feed-URLs gebruiken een
publieke basis-URL:

- `PUBLIC_BASE_URL` (optioneel) — bv. `https://api.webshop-crm.nl`. Wordt los uit
  `process.env` gelezen (env.ts NIET aangeraakt). **Fallback** = `API_PUBLIC_URL`
  (bestaande env). Zelfde patroon als `lib/storage` met `STORAGE_PUBLIC_BASE_URL`.

> Als Atlas dit netjes wil typen: voeg later `PUBLIC_BASE_URL: z.string().url().optional()`
> aan `EnvSchema` toe. Niet nodig voor werking — de fallback dekt het af.

`.env.example`-suggestie:
```
# Publieke basis-URL voor feed-links + publieke feed/analytics-URLs (default = API_PUBLIC_URL)
PUBLIC_BASE_URL=http://localhost:7300
```

---

## 5. CORS (1 regel uitbreiden — voor analytics.json)

De globale CORS in `apps/api/src/index.ts` reflecteert origins alleen voor
`/api/storefront/`. De publieke feeds leven onder `/api/feeds/public/`.

- **`google.xml` / `meta.csv`** worden **server-side** door Google Merchant Center
  en Meta gecrawld → **geen CORS nodig**.
- **`analytics.json`** wordt **door de browser** (storefront-SDK, fetch) opgehaald
  vanaf een ander origin → **CORS nodig**.

Breid de origin-check in `index.ts` met één conditie uit (naast de storefront-regel):

```ts
// in de cors origin-callback, naast de storefront-regel:
if (c.req.path.startsWith('/api/storefront/')) return origin;
if (c.req.path.startsWith('/api/feeds/public/')) return origin; // ← toevoegen
```

> Niet-blokkerend: zonder deze regel werken de feeds (server-crawl) gewoon; alleen
> een browser-fetch van `analytics.json` cross-origin zou anders door CORS geblokt
> worden. Server-side storefront-render (SSR) heeft het sowieso niet nodig.

---

## 6. Migratie-SQL (handgeschreven — `0005_marketing.sql`)

> Zelfde conventie als 0003/0004: drizzle-kit kan de ESM `.js`-imports niet via
> z'n CJS-loader resolven, dus handmatig + PUUR ADDITIEF. `CREATE TABLE IF NOT
> EXISTS` + named UNIQUE-constraints. `updated_at` wordt in code gezet
> (`updatedAt: new Date()`), net als alle andere modules — DB-triggers zijn
> OPTIONEEL (zie onderaan).

```sql
-- ============================================================
-- Migration 0005 — Wave-M: marketing feeds + storefront analytics.
-- Puur additief. 2 nieuwe tabellen, geen bestaande kolom aangeraakt.
-- ============================================================

-- ─── storefront_analytics ────────────────────────────────────
-- Per shop EXACT 1 rij (UNIQUE shop_id). Publieke client-side tag-ids.
CREATE TABLE IF NOT EXISTS "storefront_analytics" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"                     uuid NOT NULL,
  "ga4_measurement_id"          text,
  "meta_pixel_id"               text,
  "google_ads_id"               text,
  "google_ads_conversion_label" text,
  "custom_head_html"            text,
  "enabled"                     boolean NOT NULL DEFAULT true,
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "updated_at"                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "storefront_analytics_shop_id_unique" UNIQUE ("shop_id"),
  CONSTRAINT "storefront_analytics_shop_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE
);

-- ─── feed_config ─────────────────────────────────────────────
-- Per (shop, channel) 1 rij. channel = 'google_shopping' | 'meta'.
CREATE TABLE IF NOT EXISTS "feed_config" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"              uuid NOT NULL,
  "channel"              text NOT NULL,
  "enabled"              boolean NOT NULL DEFAULT true,
  "include_out_of_stock" boolean NOT NULL DEFAULT false,
  "currency"             text NOT NULL DEFAULT 'EUR',
  "config"               jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_built_at"        timestamptz,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "feed_config_shop_channel_unique" UNIQUE ("shop_id", "channel"),
  CONSTRAINT "feed_config_shop_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE
);

-- Lookup-index voor de publieke feed-routes (per shop).
CREATE INDEX IF NOT EXISTS "feed_config_shop_id_idx" ON "feed_config" ("shop_id");

-- ─── OPTIONEEL — updated_at-triggers ─────────────────────────
-- De app zet updated_at zelf in code; deze triggers zijn alleen nodig als je
-- ook DB-direct-writes wilt afdekken. (De rest van de codebase gebruikt GEEN
-- DB-triggers — laat weg voor consistentie, of voeg toe als je dat wilt.)
--
-- CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
-- BEGIN NEW.updated_at = now(); RETURN NEW; END;
-- $$ LANGUAGE plpgsql;
--
-- DROP TRIGGER IF EXISTS trg_storefront_analytics_updated_at ON "storefront_analytics";
-- CREATE TRIGGER trg_storefront_analytics_updated_at
--   BEFORE UPDATE ON "storefront_analytics"
--   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--
-- DROP TRIGGER IF EXISTS trg_feed_config_updated_at ON "feed_config";
-- CREATE TRIGGER trg_feed_config_updated_at
--   BEFORE UPDATE ON "feed_config"
--   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## 7. Endpoints

### AUTHED (`requireAuth`)
| Method | Path | Body / Query | Omschrijving |
|---|---|---|---|
| GET | `/api/feeds/analytics?shop_id=<uuid>` | — | analytics-config van shop (`{ analytics: dto \| null }`) |
| PUT | `/api/feeds/analytics?shop_id=<uuid>` | `{ ga4MeasurementId?, metaPixelId?, googleAdsId?, googleAdsConversionLabel?, customHeadHtml?, enabled? }` | upsert (lege string → null) |
| GET | `/api/feeds/configs?shop_id=<uuid>` | — | feed-configs van shop |
| PUT | `/api/feeds/configs?shop_id=<uuid>` | `{ channel:'google_shopping'\|'meta', enabled?, includeOutOfStock?, currency?, config? }` | upsert per (shop, channel) |
| POST | `/api/feeds/configs/:id/rebuild` | — | zet `last_built_at`, geeft `{ config, itemCount }` |

### PUBLIC (geen auth)
| Method | Path | Content-Type | Omschrijving |
|---|---|---|---|
| GET | `/api/feeds/public/:shopId/google.xml` | `application/xml` | Google Shopping RSS 2.0 (geldige LEGE feed bij onbekende shop) |
| GET | `/api/feeds/public/:shopId/meta.csv` | `text/csv` | Meta catalog CSV (respecteert meta `feed_config`) |
| GET | `/api/feeds/public/:shopId/analytics.json` | `application/json` | publieke tag-ids voor de storefront-SDK |

---

## 8. Publieke feed-URL-formaat (plak in GMC / Meta)

```
Google Shopping : {PUBLIC_BASE_URL}/api/feeds/public/{shopId}/google.xml
Meta catalog    : {PUBLIC_BASE_URL}/api/feeds/public/{shopId}/meta.csv
```

Deze worden ook door de API teruggegeven (`publicFeedUrl` in elke `feed_config`-DTO),
zodat de admin-UI ze direct copy-paste-baar toont. De operator zet de URL in:
- **Google Merchant Center** → Products → Feeds → "Scheduled fetch" → plak `google.xml`.
- **Meta Commerce Manager** → Catalog → Data sources → "Scheduled feed" → plak `meta.csv`.

Geen extern account/API-key nodig om de feed te genereren ("connect-ready"): de
feed wordt server-side gerenderd uit GEPUBLICEERDE shop-producten.

---

## 9. `analytics.json`-shape (voor de storefront-SDK)

`GET /api/feeds/public/{shopId}/analytics.json` →

```jsonc
{
  "enabled": true,                       // false bij disabled/onbekende shop
  "ga4MeasurementId": "G-XXXXXXXXXX",    // of null
  "metaPixelId": "123456789012345",      // of null
  "googleAdsId": "AW-123456789",         // of null
  "googleAdsConversionLabel": "abcDEF",  // of null
  "customHeadHtml": "<meta ...>"         // of null
}
```

Wanneer `enabled:false` (rij ontbreekt of `enabled=false`) → alle id-velden null;
de storefront rendert dan GEEN tags. De storefront-SDK haalt deze JSON op (1×, mag
gecached) en injecteert per non-null id het bijbehorende script:
- `ga4MeasurementId` → gtag.js (`https://www.googletagmanager.com/gtag/js?id=<id>`)
- `metaPixelId` → Meta Pixel base-snippet
- `googleAdsId` (+ `googleAdsConversionLabel`) → Google Ads gtag + conversie-event
- `customHeadHtml` → rauw in `<head>` (operator-verantwoordelijkheid)

---

## 10. Hergebruikte storefront-bron (feed == winkel)

`domain/feeds/build.ts#buildFeedItems` gebruikt EXACT dezelfde bron als de
publieke storefront-catalogus (`routes/storefront/catalog.ts` + `_pricing.ts`):
- gepubliceerd = `shop_products.published = true`
- alleen `variants.active = true`
- prijs = `effectivePrice(variant, shop_products.price_override)` (storefront-helper)
- voorraad = `availableByVariant(...)` (storefront-helper) → `in_stock` / `out_of_stock`
- primary image = laagste-position `product_images.url`

Granulariteit: de feed emit 1 regel **per actieve variant** (feed-id = SKU,
fallback variant-id), terwijl de storefront 1 kaart per product toont — beide
gebruiken dezelfde prijs/voorraad-bron, dus de getoonde prijs/beschikbaarheid matcht.

## 11. Folder-eigendom (strikt)
`routes/feeds/{index.ts,_schemas.ts,_serialize.ts,REGISTER.md}`,
`domain/feeds/{types.ts,build.ts,google.ts,meta.ts}`,
`db/schema/marketing.ts`, `db/seed-marketing.ts`.
Geen `routes/index.ts`, `db/schema/index.ts`, `db/seed.ts`, `lib/env.ts`,
migrations, shops-schema of storefront-routes aangeraakt — die wired de orchestrator.
