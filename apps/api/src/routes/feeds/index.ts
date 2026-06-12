/**
 * Feeds + marketing-router — `/api/feeds/*`.
 *
 * Twee duidelijk gescheiden sub-routers onder één mount:
 *
 *   AUTHED  (`requireAuth`) — admin-CRUD voor de operator:
 *     GET  /api/feeds/analytics?shop_id=          — analytics-config van een shop
 *     PUT  /api/feeds/analytics?shop_id=          — upsert analytics-config
 *     GET  /api/feeds/configs?shop_id=            — feed-configs van een shop
 *     PUT  /api/feeds/configs?shop_id=            — upsert feed-config (per channel)
 *     POST /api/feeds/configs/:id/rebuild         — markeer last_built_at + item-count
 *     GET  /api/feeds/configs/validate?shop_id=   — GMC feed-check (verplichte velden)
 *
 *   PUBLIC  (GEEN auth, zoals storefront) — door Google/Meta/storefront opgehaald:
 *     GET  /api/feeds/public/:shopId/google.xml   — Google Shopping RSS 2.0
 *     GET  /api/feeds/public/:shopId/meta.csv     — Meta catalog CSV
 *     GET  /api/feeds/public/:shopId/analytics.json — publieke tag-ids voor de storefront
 *     GET  /api/feeds/public/:shopId/tags.js      — kant-en-klare storefront-tags (1 scripttag)
 *
 * STRUCTUUR: de public-routes mogen NOOIT achter `requireAuth`. Daarom hangen we
 * `requireAuth` NIET op de parent-router, maar alleen op de `authed` sub-Hono.
 * De `public` sub-Hono krijgt geen auth-middleware. Beide worden via
 * `.route()` op de parent gemount → één mount in routes/index.ts.
 *
 * CORS: de globale middleware in `index.ts` reflecteert origins voor
 * `/api/storefront/`. De publieke feeds leven onder `/api/feeds/public/` — zie
 * REGISTER.md voor de 1-regel-uitbreiding zodat `analytics.json` (browser-fetch
 * door de storefront-SDK) cross-origin werkt. Feeds zelf worden server-side
 * door GMC/Meta gecrawld (geen CORS nodig).
 *
 * Mutaties lopen via `runInTransactionWithAudit` (entityType
 * 'storefront_analytics' | 'feed_config').
 *
 * Wired in routes/index.ts door de orchestrator — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAdmin, type AuthVariables } from '../../middleware/auth.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { shops } from '../../db/schema/shops.js';
import {
  storefrontAnalytics,
  feedConfig,
} from '../../db/schema/marketing.js';
import { buildFeed, buildFeedItems } from '../../domain/feeds/build.js';
import { renderGoogleShoppingXml } from '../../domain/feeds/google.js';
import { renderMetaCsv } from '../../domain/feeds/meta.js';
import { renderStorefrontTagsJs } from '../../domain/feeds/tags.js';
import { validateGoogleFeed } from '../../domain/feeds/validate.js';
import {
  AnalyticsUpsertSchema,
  FeedConfigUpsertSchema,
  ShopIdQuerySchema,
} from './_schemas.js';
import {
  toAnalyticsDto,
  toFeedConfigDto,
  toPublicAnalyticsDto,
} from './_serialize.js';

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

// ════════════════════════════════════════════════════════════════
// AUTHED sub-router — admin-CRUD (multi-user: admin-only; tenants beheren
// in V1 geen marketing-feeds)
// ════════════════════════════════════════════════════════════════

const authedRoutes = new Hono<{ Variables: AuthVariables }>();
authedRoutes.use('*', requireAdmin);

/** Helper: bestaat de shop? */
async function shopExists(shopId: string): Promise<boolean> {
  const [row] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
  return !!row;
}

// ─── GET /analytics?shop_id= ─────────────────────────────────

authedRoutes.get('/analytics', async (c) => {
  const parsed = ShopIdQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const shopId = parsed.data.shop_id;
  if (!(await shopExists(shopId))) return c.json({ error: 'shop_not_found' }, 404);

  const [row] = await db
    .select()
    .from(storefrontAnalytics)
    .where(eq(storefrontAnalytics.shopId, shopId))
    .limit(1);

  // Geen rij → geef een lege (niet-gepersisteerde) default terug zodat de UI
  // een formulier kan tonen. PUT maakt de rij dan aan.
  if (!row) {
    return c.json({ analytics: null, shopId });
  }
  return c.json({ analytics: toAnalyticsDto(row) });
});

// ─── PUT /analytics?shop_id= — upsert ────────────────────────

authedRoutes.put('/analytics', async (c) => {
  const q = ShopIdQuerySchema.safeParse(c.req.query());
  if (!q.success) {
    return c.json({ error: 'invalid_request', details: q.error.flatten() }, 400);
  }
  const shopId = q.data.shop_id;
  if (!(await shopExists(shopId))) return c.json({ error: 'shop_not_found' }, 404);

  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = AnalyticsUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [existing] = await tx
      .select()
      .from(storefrontAnalytics)
      .where(eq(storefrontAnalytics.shopId, shopId))
      .limit(1);

    let row: typeof storefrontAnalytics.$inferSelect;
    let action: string;
    if (existing) {
      const setValues: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.ga4MeasurementId !== undefined) setValues.ga4MeasurementId = patch.ga4MeasurementId;
      if (patch.metaPixelId !== undefined) setValues.metaPixelId = patch.metaPixelId;
      if (patch.googleAdsId !== undefined) setValues.googleAdsId = patch.googleAdsId;
      if (patch.googleAdsConversionLabel !== undefined)
        setValues.googleAdsConversionLabel = patch.googleAdsConversionLabel;
      if (patch.clarityProjectId !== undefined) setValues.clarityProjectId = patch.clarityProjectId;
      if (patch.customHeadHtml !== undefined) setValues.customHeadHtml = patch.customHeadHtml;
      if (patch.enabled !== undefined) setValues.enabled = patch.enabled;

      const [updated] = await tx
        .update(storefrontAnalytics)
        .set(setValues)
        .where(eq(storefrontAnalytics.id, existing.id))
        .returning();
      if (!updated) throw new Error('storefront_analytics update returned no row');
      row = updated;
      action = 'update';
    } else {
      const [inserted] = await tx
        .insert(storefrontAnalytics)
        .values({
          shopId,
          ga4MeasurementId: patch.ga4MeasurementId ?? null,
          metaPixelId: patch.metaPixelId ?? null,
          googleAdsId: patch.googleAdsId ?? null,
          googleAdsConversionLabel: patch.googleAdsConversionLabel ?? null,
          clarityProjectId: patch.clarityProjectId ?? null,
          customHeadHtml: patch.customHeadHtml ?? null,
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        })
        .returning();
      if (!inserted) throw new Error('storefront_analytics insert returned no row');
      row = inserted;
      action = 'create';
    }

    audit.set({
      actor: { type: 'user', id: user.id },
      action,
      entityType: 'storefront_analytics',
      entityId: row.id,
      before: existing
        ? { ga4: existing.ga4MeasurementId, pixel: existing.metaPixelId, enabled: existing.enabled }
        : null,
      after: { ga4: row.ga4MeasurementId, pixel: row.metaPixelId, enabled: row.enabled },
      ip: ip(c),
    });
    return { row, action };
  });

  logger.info({ shopId, action: result.action, actor: user.id }, 'storefront_analytics upserted');
  return c.json({ analytics: toAnalyticsDto(result.row) }, result.action === 'create' ? 201 : 200);
});

// ─── GET /configs?shop_id= ───────────────────────────────────

authedRoutes.get('/configs', async (c) => {
  const parsed = ShopIdQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const shopId = parsed.data.shop_id;
  if (!(await shopExists(shopId))) return c.json({ error: 'shop_not_found' }, 404);

  const rows = await db
    .select()
    .from(feedConfig)
    .where(eq(feedConfig.shopId, shopId))
    .orderBy(asc(feedConfig.channel));

  return c.json({ shopId, items: rows.map((r) => toFeedConfigDto(r)), total: rows.length });
});

// ─── PUT /configs?shop_id= — upsert per (shop, channel) ──────

authedRoutes.put('/configs', async (c) => {
  const q = ShopIdQuerySchema.safeParse(c.req.query());
  if (!q.success) {
    return c.json({ error: 'invalid_request', details: q.error.flatten() }, 400);
  }
  const shopId = q.data.shop_id;
  if (!(await shopExists(shopId))) return c.json({ error: 'shop_not_found' }, 404);

  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = FeedConfigUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [existing] = await tx
      .select()
      .from(feedConfig)
      .where(and(eq(feedConfig.shopId, shopId), eq(feedConfig.channel, patch.channel)))
      .limit(1);

    let row: typeof feedConfig.$inferSelect;
    let action: string;
    if (existing) {
      const setValues: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.enabled !== undefined) setValues.enabled = patch.enabled;
      if (patch.includeOutOfStock !== undefined) setValues.includeOutOfStock = patch.includeOutOfStock;
      if (patch.currency !== undefined) setValues.currency = patch.currency;
      if (patch.config !== undefined) setValues.config = patch.config;

      const [updated] = await tx
        .update(feedConfig)
        .set(setValues)
        .where(eq(feedConfig.id, existing.id))
        .returning();
      if (!updated) throw new Error('feed_config update returned no row');
      row = updated;
      action = 'update';
    } else {
      const [inserted] = await tx
        .insert(feedConfig)
        .values({
          shopId,
          channel: patch.channel,
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.includeOutOfStock !== undefined
            ? { includeOutOfStock: patch.includeOutOfStock }
            : {}),
          ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
          ...(patch.config !== undefined ? { config: patch.config } : {}),
        })
        .returning();
      if (!inserted) throw new Error('feed_config insert returned no row');
      row = inserted;
      action = 'create';
    }

    audit.set({
      actor: { type: 'user', id: user.id },
      action,
      entityType: 'feed_config',
      entityId: row.id,
      before: existing ? { enabled: existing.enabled, currency: existing.currency } : null,
      after: { channel: row.channel, enabled: row.enabled, currency: row.currency },
      ip: ip(c),
    });
    return { row, action };
  });

  logger.info(
    { shopId, channel: patch.channel, action: result.action, actor: user.id },
    'feed_config upserted',
  );
  return c.json({ config: toFeedConfigDto(result.row) }, result.action === 'create' ? 201 : 200);
});

// ─── POST /configs/:id/rebuild — set last_built_at + item-count ──

authedRoutes.post('/configs/:id/rebuild', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [cfg] = await db.select().from(feedConfig).where(eq(feedConfig.id, id)).limit(1);
  if (!cfg) return c.json({ error: 'not_found' }, 404);

  // Tel de items die de feed nu zou bevatten (zelfde bron als de publieke feed).
  const items = await buildFeedItems(cfg.shopId, {
    includeOutOfStock: cfg.includeOutOfStock,
    currency: cfg.currency,
  });

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const builtAt = new Date();
    const [row] = await tx
      .update(feedConfig)
      .set({ lastBuiltAt: builtAt, updatedAt: builtAt })
      .where(eq(feedConfig.id, id))
      .returning();
    if (!row) throw new Error('feed_config rebuild update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'rebuild',
      entityType: 'feed_config',
      entityId: row.id,
      after: { channel: row.channel, itemCount: items.length, lastBuiltAt: builtAt.toISOString() },
      ip: ip(c),
    });
    return row;
  });

  logger.info(
    { feedConfigId: id, channel: cfg.channel, itemCount: items.length, actor: user.id },
    'feed_config rebuilt',
  );
  return c.json({ config: toFeedConfigDto(updated), itemCount: items.length });
});

// ─── GET /configs/validate?shop_id= — GMC feed-check ─────────────
//
// Draait dezelfde bron als de publieke google.xml-feed en rapporteert per
// product of de GMC-verplichte velden aanwezig zijn (image_link, price, title,
// …) + waarschuwt bij ontbrekend merk/GTIN. Geen mutatie — puur read-side.

authedRoutes.get('/configs/validate', async (c) => {
  const parsed = ShopIdQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const shopId = parsed.data.shop_id;
  if (!(await shopExists(shopId))) return c.json({ error: 'shop_not_found' }, 404);

  // Respecteer de google_shopping feed_config (includeOutOfStock/currency) als die bestaat.
  const [cfg] = await db
    .select()
    .from(feedConfig)
    .where(and(eq(feedConfig.shopId, shopId), eq(feedConfig.channel, 'google_shopping')))
    .limit(1);

  const report = await validateGoogleFeed(shopId, {
    includeOutOfStock: cfg?.includeOutOfStock ?? false,
    currency: cfg?.currency,
  });
  return c.json({ report });
});

// ════════════════════════════════════════════════════════════════
// PUBLIC sub-router — GEEN auth (zoals storefront)
// ════════════════════════════════════════════════════════════════

const publicRoutes = new Hono();

/** Resolve een actieve shop op id. Public feeds tonen alleen `active` shops. */
async function resolvePublicShop(shopId: string) {
  if (!isUuid(shopId)) return null;
  const [row] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!row) return null;
  return row;
}

// ─── GET /public/:shopId/google.xml ──────────────────────────

publicRoutes.get('/:shopId/google.xml', async (c) => {
  const shop = await resolvePublicShop(c.req.param('shopId'));
  // Never-throw: onbekende shop → geldige LEGE feed (Google verwacht 200 + XML).
  if (!shop) {
    const empty = renderGoogleShoppingXml(
      { id: c.req.param('shopId'), slug: 'unknown', name: 'Unknown shop', domain: null, currency: 'EUR' },
      [],
    );
    return c.body(empty, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
  }
  const rendered = await buildFeed(shop, 'google_shopping');
  return c.body(rendered.body, 200, { 'Content-Type': rendered.contentType });
});

// ─── GET /public/:shopId/meta.csv ────────────────────────────

publicRoutes.get('/:shopId/meta.csv', async (c) => {
  const shop = await resolvePublicShop(c.req.param('shopId'));
  if (!shop) {
    const empty = renderMetaCsv(
      { id: c.req.param('shopId'), slug: 'unknown', name: 'Unknown shop', domain: null, currency: 'EUR' },
      [],
    );
    return c.body(empty, 200, { 'Content-Type': 'text/csv; charset=utf-8' });
  }
  // Respecteer feed_config.includeOutOfStock/currency als er een meta-config is.
  const [cfg] = await db
    .select()
    .from(feedConfig)
    .where(and(eq(feedConfig.shopId, shop.id), eq(feedConfig.channel, 'meta')))
    .limit(1);
  const rendered = await buildFeed(shop, 'meta', {
    includeOutOfStock: cfg?.includeOutOfStock ?? false,
    currency: cfg?.currency ?? shop.currency,
  });
  return c.body(rendered.body, 200, { 'Content-Type': rendered.contentType });
});

// ─── GET /public/:shopId/analytics.json ──────────────────────
//
// De publieke tag-ids die de storefront-SDK nodig heeft om GA4/Pixel/Ads te
// renderen. Alleen non-null + enabled. Disabled/onbekend → enabled:false.

publicRoutes.get('/:shopId/analytics.json', async (c) => {
  const shopId = c.req.param('shopId');
  if (!isUuid(shopId)) {
    return c.json(toPublicAnalyticsDto(null));
  }
  const [row] = await db
    .select()
    .from(storefrontAnalytics)
    .where(eq(storefrontAnalytics.shopId, shopId))
    .limit(1);
  return c.json(toPublicAnalyticsDto(row ?? null));
});

// ─── GET /public/:shopId/tags.js ─────────────────────────────────
//
// Eén scripttag voor de storefront: kant-en-klare JS die GA4, Google Ads,
// Meta Pixel, Microsoft Clarity en de custom-head-HTML laadt op basis van de
// opgeslagen ids. enabled-gating via toPublicAnalyticsDto (disabled → no-op JS).

publicRoutes.get('/:shopId/tags.js', async (c) => {
  const headers = {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
  };
  const shopId = c.req.param('shopId');
  if (!isUuid(shopId)) {
    return c.body(renderStorefrontTagsJs(toPublicAnalyticsDto(null)), 200, headers);
  }
  const [row] = await db
    .select()
    .from(storefrontAnalytics)
    .where(eq(storefrontAnalytics.shopId, shopId))
    .limit(1);
  return c.body(renderStorefrontTagsJs(toPublicAnalyticsDto(row ?? null)), 200, headers);
});

// ════════════════════════════════════════════════════════════════
// Parent-router — mount beide. GEEN parent-level requireAuth zodat
// /public/* publiek blijft; auth zit op de authed sub-Hono.
// ════════════════════════════════════════════════════════════════

export const feedsRoutes = new Hono<{ Variables: AuthVariables }>();
feedsRoutes.route('/public', publicRoutes);
feedsRoutes.route('/', authedRoutes);
