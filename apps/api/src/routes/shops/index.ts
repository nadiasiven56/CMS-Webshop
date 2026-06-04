/**
 * Shops-router — `/api/shops/*`.
 *
 * Multi-shop tenant-beheer + per-shop product-publicatie.
 *
 * Endpoints (alle achter `requireAuth`):
 *   GET    /api/shops                          — list (paginate + filter status/search)
 *   POST   /api/shops                          — create shop
 *   GET    /api/shops/:id                      — detail
 *   PATCH  /api/shops/:id                      — partial update
 *   DELETE /api/shops/:id                      — delete (cascade op shop_products/CMS/etc.)
 *   GET    /api/shops/:id/products             — gepubliceerde + niet-gepubliceerde
 *                                                shop_products (join met products),
 *                                                ?publishedOnly=true filtert
 *   PUT    /api/shops/:id/products/:productId  — upsert publicatie-status
 *                                                (toggle published / price_override / position)
 *
 * Writes lopen via `runInTransactionWithAudit` zodat `audit_log` automatisch
 * meeschrijft. Geld = string (Money). `inArray()` i.p.v. `ANY()`.
 *
 * Wired in routes/index.ts door finalizer (Atlas) — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { and, asc, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { shops } from '../../db/schema/shops.js';
import { shopProducts } from '../../db/schema/shop-products.js';
import { products } from '../../db/schema/products.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { encryptCredentials } from '../../lib/channel-crypto.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import {
  ShopCreateSchema,
  ShopUpdateSchema,
  ShopListQuerySchema,
  ShopProductUpsertSchema,
  ShopProductsQuerySchema,
} from './_schemas.js';
import { toShopDto, toShopProductDto } from './_serialize.js';
import { registerStorefrontTokenRoutes } from './storefront-token.js';

export const shopsRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles — admin-module.
shopsRoutes.use('*', requireAuth);

// Per-shop publishable storefront-token (genereer/roteer/intrek/presence).
// Geregistreerd op dezelfde router → erft `requireAuth` + bestaande mount op
// `/api/shops`. Geen extra mount in routes/index.ts nodig.
registerStorefrontTokenRoutes(shopsRoutes);

// ─── GET /api/shops — list ───────────────────────────────────

shopsRoutes.get('/', async (c) => {
  const parsed = ShopListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset, status, search } = parsed.data;

  const conditions = [];
  if (status) conditions.push(eq(shops.status, status));
  if (search) {
    const term = `%${search}%`;
    conditions.push(or(ilike(shops.name, term), ilike(shops.slug, term), ilike(shops.domain, term)));
  }
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(shops)
    .orderBy(asc(shops.name))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  // total
  const allIds = await (whereExpr
    ? db.select({ id: shops.id }).from(shops).where(whereExpr)
    : db.select({ id: shops.id }).from(shops));
  const total = allIds.length;

  return c.json({
    items: rows.map(toShopDto),
    total,
    limit,
    offset,
  });
});

// ─── POST /api/shops — create ────────────────────────────────

shopsRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ShopCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  // Uniqueness pre-checks (vriendelijke 409 i.p.v. raw DB-constraint-error).
  const [slugClash] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.slug, input.slug))
    .limit(1);
  if (slugClash) {
    return c.json({ error: 'slug_taken', field: 'slug' }, 409);
  }
  if (input.domain) {
    const [domainClash] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.domain, input.domain))
      .limit(1);
    if (domainClash) {
      return c.json({ error: 'domain_taken', field: 'domain' }, 409);
    }
  }

  try {
    const shop = await runInTransactionWithAudit(async (tx, audit) => {
      const [row] = await tx
        .insert(shops)
        .values({
          slug: input.slug,
          name: input.name,
          domain: input.domain ?? null,
          ...(input.locale ? { locale: input.locale } : {}),
          ...(input.currency ? { currency: input.currency } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.branding ? { branding: input.branding } : {}),
          ...(input.vatConfig ? { vatConfig: input.vatConfig } : {}),
          defaultLocationId: input.defaultLocationId ?? null,
          supportEmail: input.supportEmail ?? null,
        })
        .returning();
      if (!row) throw new Error('shop insert returned no row');

      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'create',
        entityType: 'shop',
        entityId: row.id,
        before: null,
        after: { id: row.id, slug: row.slug, name: row.name, status: row.status },
        ip,
      });
      return row;
    });

    logger.info({ shopId: shop.id, slug: shop.slug, actor: user.id }, 'shop created');
    return c.json({ shop: toShopDto(shop) }, 201);
  } catch (err) {
    logger.error({ err, slug: input.slug }, 'shop create failed');
    throw err;
  }
});

// ─── GET /api/shops/:id — detail ─────────────────────────────

shopsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const [shop] = await db.select().from(shops).where(eq(shops.id, id)).limit(1);
  if (!shop) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ shop: toShopDto(shop) });
});

// ─── PATCH /api/shops/:id — update ───────────────────────────

shopsRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ShopUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const [existing] = await db.select().from(shops).where(eq(shops.id, id)).limit(1);
  if (!existing) {
    return c.json({ error: 'not_found' }, 404);
  }

  // Uniqueness pre-checks bij slug/domain-wissel.
  if (patch.slug && patch.slug !== existing.slug) {
    const [clash] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.slug, patch.slug))
      .limit(1);
    if (clash) return c.json({ error: 'slug_taken', field: 'slug' }, 409);
  }
  if (patch.domain && patch.domain !== existing.domain) {
    const [clash] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.domain, patch.domain))
      .limit(1);
    if (clash) return c.json({ error: 'domain_taken', field: 'domain' }, 409);
  }

  // Bouw set-object alleen voor meegegeven velden (partial update).
  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.slug !== undefined) setValues.slug = patch.slug;
  if (patch.name !== undefined) setValues.name = patch.name;
  if (patch.domain !== undefined) setValues.domain = patch.domain;
  if (patch.locale !== undefined) setValues.locale = patch.locale;
  if (patch.currency !== undefined) setValues.currency = patch.currency;
  if (patch.status !== undefined) setValues.status = patch.status;
  if (patch.branding !== undefined) setValues.branding = patch.branding;
  if (patch.vatConfig !== undefined) setValues.vatConfig = patch.vatConfig;
  if (patch.defaultLocationId !== undefined)
    setValues.defaultLocationId = patch.defaultLocationId;
  if (patch.supportEmail !== undefined) setValues.supportEmail = patch.supportEmail;
  if (patch.paymentProvider !== undefined) setValues.paymentProvider = patch.paymentProvider;
  if (patch.paymentCredentials !== undefined)
    setValues.paymentCredentials = patch.paymentCredentials
      ? encryptCredentials(patch.paymentCredentials as Record<string, unknown>)
      : null;

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(shops)
      .set(setValues)
      .where(eq(shops.id, id))
      .returning();
    if (!row) throw new Error('shop update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'shop',
      entityId: row.id,
      before: {
        slug: existing.slug,
        name: existing.name,
        domain: existing.domain,
        status: existing.status,
      },
      after: { slug: row.slug, name: row.name, domain: row.domain, status: row.status },
      ip,
    });
    return row;
  });

  logger.info({ shopId: id, actor: user.id }, 'shop updated');
  return c.json({ shop: toShopDto(updated) });
});

// ─── DELETE /api/shops/:id ───────────────────────────────────

shopsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const [existing] = await db.select().from(shops).where(eq(shops.id, id)).limit(1);
  if (!existing) {
    return c.json({ error: 'not_found' }, 404);
  }

  await runInTransactionWithAudit(async (tx, audit) => {
    await tx.delete(shops).where(eq(shops.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'shop',
      entityId: id,
      before: { id: existing.id, slug: existing.slug, name: existing.name },
      after: null,
      ip,
    });
  });

  logger.info({ shopId: id, actor: user.id }, 'shop deleted');
  return c.json({ ok: true, id });
});

// ─── GET /api/shops/:id/products — publicatie-lijst ──────────

shopsRoutes.get('/:id/products', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const parsed = ShopProductsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { publishedOnly } = parsed.data;

  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, id)).limit(1);
  if (!shop) {
    return c.json({ error: 'shop_not_found' }, 404);
  }

  const conditions = [eq(shopProducts.shopId, id)];
  if (publishedOnly) conditions.push(eq(shopProducts.published, true));

  const rows = await db
    .select({
      sp: shopProducts,
      productId: products.id,
      productSlug: products.slug,
      productTitle: products.title,
      productStatus: products.status,
    })
    .from(shopProducts)
    .innerJoin(products, eq(products.id, shopProducts.productId))
    .where(and(...conditions))
    .orderBy(asc(shopProducts.position), desc(shopProducts.publishedAt));

  return c.json({
    shopId: id,
    items: rows.map((r) =>
      toShopProductDto(r.sp, {
        id: r.productId,
        slug: r.productSlug,
        title: r.productTitle,
        status: r.productStatus,
      }),
    ),
    total: rows.length,
  });
});

// ─── PUT /api/shops/:id/products/:productId — upsert publicatie ───

shopsRoutes.put('/:id/products/:productId', async (c) => {
  const id = c.req.param('id');
  const productId = c.req.param('productId');
  if (!isUuid(id) || !isUuid(productId)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ShopProductUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  // Bestaat de shop + het product?
  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, id)).limit(1);
  if (!shop) {
    return c.json({ error: 'shop_not_found' }, 404);
  }
  const [product] = await db
    .select({ id: products.id, slug: products.slug, title: products.title, status: products.status })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) {
    return c.json({ error: 'product_not_found' }, 404);
  }

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    // Bestaande join-row?
    const [existing] = await tx
      .select()
      .from(shopProducts)
      .where(and(eq(shopProducts.shopId, id), eq(shopProducts.productId, productId)))
      .limit(1);

    // Bepaal nieuwe published-status + published_at.
    const nextPublished =
      patch.published !== undefined ? patch.published : existing?.published ?? false;
    // published_at: zet bij eerste keer published, behoud daarna, clear bij unpublish.
    let nextPublishedAt: Date | null;
    if (nextPublished) {
      nextPublishedAt = existing?.publishedAt ?? new Date();
    } else {
      nextPublishedAt = null;
    }

    let row: typeof shopProducts.$inferSelect;
    let action: string;
    if (existing) {
      const setValues: Record<string, unknown> = {
        published: nextPublished,
        publishedAt: nextPublishedAt,
      };
      if (patch.priceOverride !== undefined) setValues.priceOverride = patch.priceOverride;
      if (patch.position !== undefined) setValues.position = patch.position;

      const [updated] = await tx
        .update(shopProducts)
        .set(setValues)
        .where(eq(shopProducts.id, existing.id))
        .returning();
      if (!updated) throw new Error('shop_product update returned no row');
      row = updated;
      action = 'update';
    } else {
      const [inserted] = await tx
        .insert(shopProducts)
        .values({
          shopId: id,
          productId,
          published: nextPublished,
          priceOverride: patch.priceOverride ?? null,
          position: patch.position ?? 0,
          publishedAt: nextPublishedAt,
        })
        .returning();
      if (!inserted) throw new Error('shop_product insert returned no row');
      row = inserted;
      action = 'create';
    }

    audit.set({
      actor: { type: 'user', id: user.id },
      action,
      entityType: 'shop_product',
      entityId: row.id,
      before: existing
        ? {
            published: existing.published,
            priceOverride: existing.priceOverride,
            position: existing.position,
          }
        : null,
      after: {
        shopId: row.shopId,
        productId: row.productId,
        published: row.published,
        priceOverride: row.priceOverride,
        position: row.position,
      },
      ip,
    });

    return { row, action };
  });

  logger.info(
    { shopId: id, productId, action: result.action, actor: user.id },
    'shop_product upserted',
  );

  return c.json(
    {
      shopProduct: toShopProductDto(result.row, {
        id: product.id,
        slug: product.slug,
        title: product.title,
        status: product.status,
      }),
    },
    result.action === 'create' ? 201 : 200,
  );
});
