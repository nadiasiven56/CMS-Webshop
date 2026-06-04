/**
 * Channels-router — `/api/channels/*`.
 *
 * Marketplace-/sales-channel-beheer: own_webshop (REAL) + bol/amazon/gmc
 * (CONNECT-READY). De route-laag praat NOOIT direct met een marketplace-SDK —
 * altijd via een {@link ChannelAdapter} uit de adapter-registry.
 *
 * Endpoints (alle achter `requireAuth`):
 *   GET    /api/channels                          — list (masked creds + counts)
 *   POST   /api/channels                          — create {type,name,config}
 *   GET    /api/channels/:id                      — detail (masked + counts)
 *   PATCH  /api/channels/:id                      — partial update (name/config/status)
 *   DELETE /api/channels/:id                      — delete (cascade channel_products/orders)
 *   PUT    /api/channels/:id/credentials          — encrypt → store credentials
 *   POST   /api/channels/:id/test-connection      — decrypt in-memory → verify → persist status
 *   POST   /api/channels/:id/sync                  — own_webshop: import orders + push inventory
 *   GET    /api/channels/:id/products             — channel_products listings
 *   PUT    /api/channels/:id/products/:variantId  — enable/disable + priceOverride (+ pushListing)
 *   GET    /api/channels/:id/orders               — imported channel_orders
 *
 * KRITISCH: credentials worden encrypted opgeslagen (channel-crypto) en NOOIT
 * raw teruggegeven (alleen masked presence-map via _serialize).
 *
 * Wired in routes/index.ts door finalizer — zie REGISTER.md / registerMd.
 */
import { Hono } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { encryptCredentials } from '../../lib/channel-crypto.js';
import { channels, type Channel } from '../../db/schema/channels.js';
import { channelProducts } from '../../db/schema/channel-products.js';
import { channelOrders } from '../../db/schema/channel-orders.js';
import { products } from '../../db/schema/products.js';
import { variants } from '../../db/schema/variants.js';
import { getAdapter } from './adapters/index.js';
import { isChannelNotConnectedError } from './adapters/types.js';
import {
  ChannelCreateSchema,
  ChannelListQuerySchema,
  ChannelPatchSchema,
  ChannelProductUpsertSchema,
  ChannelProductsQuerySchema,
  CREDENTIALS_SCHEMA_BY_TYPE,
} from './_schemas.js';
import {
  toChannelDto,
  toChannelDetailDto,
  toChannelOrderDto,
  toChannelProductDto,
} from './_serialize.js';
import { runChannelSync } from './sync.js';

export const channelRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles — admin-module.
channelRoutes.use('*', requireAuth);

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

/** Count helper — volgt het shops-patroon (select ids → length). */
async function countChannelChildren(
  channelId: string,
): Promise<{ products: number; orders: number }> {
  const [prodIds, orderIds] = await Promise.all([
    db
      .select({ id: channelProducts.id })
      .from(channelProducts)
      .where(eq(channelProducts.channelId, channelId)),
    db
      .select({ id: channelOrders.id })
      .from(channelOrders)
      .where(eq(channelOrders.channelId, channelId)),
  ]);
  return { products: prodIds.length, orders: orderIds.length };
}

// ─── GET /api/channels — list ────────────────────────────────

channelRoutes.get('/', async (c) => {
  const parsed = ChannelListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { type, status, limit, offset } = parsed.data;

  const conditions = [];
  if (type) conditions.push(eq(channels.type, type));
  if (status) conditions.push(eq(channels.status, status));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(channels)
    .orderBy(asc(channels.name))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: channels.id }).from(channels).where(whereExpr)
    : db.select({ id: channels.id }).from(channels));

  // Counts per channel (parallel).
  const items = await Promise.all(
    rows.map(async (ch) => {
      const counts = await countChannelChildren(ch.id);
      return toChannelDetailDto(ch, counts);
    }),
  );

  return c.json({ items, total: allIds.length, limit, offset });
});

// ─── POST /api/channels — create ─────────────────────────────

channelRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ChannelCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const channel = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .insert(channels)
      .values({
        type: input.type,
        name: input.name,
        status: 'disconnected',
        config: input.config ?? {},
      })
      .returning();
    if (!row) throw new Error('channel insert returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'channel',
      entityId: row.id,
      before: null,
      after: { id: row.id, type: row.type, name: row.name, status: row.status },
      ip: ip(c),
    });
    return row;
  });

  logger.info({ channelId: channel.id, type: channel.type, actor: user.id }, 'channel created');
  return c.json({ channel: toChannelDetailDto(channel, { products: 0, orders: 0 }) }, 201);
});

// ─── GET /api/channels/:id — detail ──────────────────────────

channelRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [channel] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
  if (!channel) return c.json({ error: 'not_found' }, 404);

  const counts = await countChannelChildren(id);
  return c.json({ channel: toChannelDetailDto(channel, counts) });
});

// ─── PATCH /api/channels/:id — update ────────────────────────

channelRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ChannelPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;

  const [existing] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) setValues.name = patch.name;
  if (patch.config !== undefined) setValues.config = patch.config;
  if (patch.status !== undefined) setValues.status = patch.status;

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(channels)
      .set(setValues)
      .where(eq(channels.id, id))
      .returning();
    if (!row) throw new Error('channel update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'channel',
      entityId: row.id,
      before: { name: existing.name, status: existing.status, config: existing.config },
      after: { name: row.name, status: row.status, config: row.config },
      ip: ip(c),
    });
    return row;
  });

  const counts = await countChannelChildren(id);
  logger.info({ channelId: id, actor: user.id }, 'channel updated');
  return c.json({ channel: toChannelDetailDto(updated, counts) });
});

// ─── DELETE /api/channels/:id — cascade ──────────────────────

channelRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [existing] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  await runInTransactionWithAudit(async (tx, audit) => {
    // channel_products + channel_orders cascaden via FK onDelete:'cascade'.
    await tx.delete(channels).where(eq(channels.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'channel',
      entityId: id,
      before: { id: existing.id, type: existing.type, name: existing.name },
      after: null,
      ip: ip(c),
    });
  });

  logger.info({ channelId: id, actor: user.id }, 'channel deleted');
  return c.json({ ok: true, id });
});

// ─── PUT /api/channels/:id/credentials — encrypt + store ─────

channelRoutes.put('/:id/credentials', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [existing] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const schema = CREDENTIALS_SCHEMA_BY_TYPE[existing.type as keyof typeof CREDENTIALS_SCHEMA_BY_TYPE];
  if (schema === undefined) {
    return c.json({ error: 'unsupported_channel_type', type: existing.type }, 422);
  }
  if (schema === null) {
    // own_webshop heeft geen externe credentials.
    return c.json(
      { error: 'no_credentials_required', message: `${existing.type} has no external credentials` },
      422,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }

  const encrypted = encryptCredentials(parsed.data as Record<string, unknown>);

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(channels)
      .set({ credentials: encrypted, updatedAt: new Date() })
      .where(eq(channels.id, id))
      .returning();
    if (!row) throw new Error('channel credentials update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'channel',
      entityId: row.id,
      // NOOIT de raw creds in audit — alleen dat ze gezet zijn.
      before: { hadCredentials: existing.credentials != null },
      after: { hasCredentials: true, fields: Object.keys(parsed.data as object) },
      ip: ip(c),
    });
    return row;
  });

  const counts = await countChannelChildren(id);
  logger.info({ channelId: id, actor: user.id }, 'channel credentials stored');
  return c.json({ channel: toChannelDetailDto(updated, counts) });
});

// ─── POST /api/channels/:id/test-connection ──────────────────

channelRoutes.post('/:id/test-connection', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [channel] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
  if (!channel) return c.json({ error: 'not_found' }, 404);

  const adapter = getAdapter(channel);
  if (!adapter) {
    return c.json({ error: 'unsupported_channel_type', type: channel.type }, 422);
  }

  // verifyConnection decrypteert in-memory (binnen de adapter) en throwt NOOIT.
  const verify = await adapter.verifyConnection(channel);
  const nextStatus = verify.ok ? 'connected' : 'error';

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(channels)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(channels.id, id))
      .returning();
    if (!row) throw new Error('channel status update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'channel',
      entityId: row.id,
      before: { status: channel.status },
      after: { status: row.status, verifyDetail: verify.detail },
      ip: ip(c),
    });
    return row;
  });

  const counts = await countChannelChildren(id);
  return c.json({
    ok: verify.ok,
    detail: verify.detail,
    channel: toChannelDetailDto(updated, counts),
  });
});

// ─── POST /api/channels/:id/sync ─────────────────────────────
//
// own_webshop: REAL + idempotent — fetchOrders → upsert channel_orders +
// updateInventory voor published variants + set lastSyncAt.
// marketplaces: guarded — als niet connected geeft de adapter een typed
// channel_not_connected (409) terug; niets vuurt zonder creds.

channelRoutes.post('/:id/sync', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');

  // De sync-kern is geëxtraheerd naar ./sync.ts zodat de scheduler exact dezelfde
  // idempotente logica draait. Hier mappen we het resultaat terug naar het
  // bestaande HTTP-contract (404/422/409/200).
  const result = await runChannelSync(id, { type: 'user', id: user.id, ip: ip(c) });

  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        return c.json({ error: 'not_found' }, 404);
      case 'unsupported_type':
        return c.json({ error: 'unsupported_channel_type', type: result.type }, 422);
      case 'not_connected':
        return c.json({ error: 'channel_not_connected', message: result.message }, 409);
    }
  }

  return c.json({
    ordersImported: result.ordersImported,
    listingsPushed: result.listingsPushed,
    errors: result.errors,
  });
});

// ─── GET /api/channels/:id/products ──────────────────────────

channelRoutes.get('/:id/products', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const parsed = ChannelProductsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { enabledOnly } = parsed.data;

  const [channel] = await db.select({ id: channels.id }).from(channels).where(eq(channels.id, id)).limit(1);
  if (!channel) return c.json({ error: 'channel_not_found' }, 404);

  const conditions = [eq(channelProducts.channelId, id)];
  if (enabledOnly) conditions.push(eq(channelProducts.status, 'active'));

  const rows = await db
    .select({
      cp: channelProducts,
      productId: products.id,
      productTitle: products.title,
      variantSku: variants.sku,
    })
    .from(channelProducts)
    .innerJoin(products, eq(products.id, channelProducts.productId))
    .leftJoin(variants, eq(variants.id, channelProducts.variantId))
    .where(and(...conditions))
    .orderBy(desc(channelProducts.lastSyncedAt));

  return c.json({
    channelId: id,
    items: rows.map((r) =>
      toChannelProductDto(r.cp, {
        id: r.productId,
        title: r.productTitle,
        sku: r.variantSku,
      }),
    ),
    total: rows.length,
  });
});

// ─── PUT /api/channels/:id/products/:variantId ───────────────

channelRoutes.put('/:id/products/:variantId', async (c) => {
  const id = c.req.param('id');
  const variantId = c.req.param('variantId');
  if (!isUuid(id) || !isUuid(variantId)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ChannelProductUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;

  const [channel] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
  if (!channel) return c.json({ error: 'channel_not_found' }, 404);

  const [variant] = await db
    .select({
      id: variants.id,
      productId: variants.productId,
      sku: variants.sku,
      price: variants.price,
      productTitle: products.title,
    })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(variants.id, variantId))
    .limit(1);
  if (!variant) return c.json({ error: 'variant_not_found' }, 404);

  const adapter = getAdapter(channel);
  if (!adapter) return c.json({ error: 'unsupported_channel_type', type: channel.type }, 422);

  // Bepaal de nieuwe enabled-status (default: behoud bestaande / start enabled).
  const [existing] = await db
    .select()
    .from(channelProducts)
    .where(and(eq(channelProducts.channelId, id), eq(channelProducts.variantId, variantId)))
    .limit(1);

  const nextEnabled =
    patch.enabled !== undefined
      ? patch.enabled
      : existing
        ? existing.status === 'active'
        : true;

  // pushListing alleen wanneer connected (marketplaces); own_webshop confirmeert
  // gewoon de variant-id. Bij niet-connected marketplace → 409.
  let externalId: string | null = existing?.externalId ?? null;
  if (nextEnabled) {
    try {
      const result = await adapter.pushListing(channel, {
        variantId: variant.id,
        productId: variant.productId,
        sku: variant.sku,
        price: patch.priceOverride ?? variant.price,
        enabled: nextEnabled,
      });
      externalId = result.externalId;
    } catch (err) {
      if (isChannelNotConnectedError(err)) {
        return c.json(
          { error: 'channel_not_connected', message: err instanceof Error ? err.message : 'not connected' },
          409,
        );
      }
      return c.json(
        { error: 'push_listing_failed', message: err instanceof Error ? err.message : 'failed' },
        502,
      );
    }
  }

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const status = nextEnabled ? 'active' : 'disabled';
    let row: typeof channelProducts.$inferSelect;
    let action: string;
    if (existing) {
      const setValues: Record<string, unknown> = {
        status,
        externalId,
        lastSyncedAt: new Date(),
      };
      if (patch.priceOverride !== undefined) setValues.priceOverride = patch.priceOverride;
      const [updated] = await tx
        .update(channelProducts)
        .set(setValues)
        .where(eq(channelProducts.id, existing.id))
        .returning();
      if (!updated) throw new Error('channel_product update returned no row');
      row = updated;
      action = 'update';
    } else {
      const [inserted] = await tx
        .insert(channelProducts)
        .values({
          channelId: id,
          productId: variant.productId,
          variantId,
          externalId,
          status,
          priceOverride: patch.priceOverride ?? null,
          lastSyncedAt: new Date(),
        })
        .returning();
      if (!inserted) throw new Error('channel_product insert returned no row');
      row = inserted;
      action = 'create';
    }

    audit.set({
      actor: { type: 'user', id: user.id },
      action,
      entityType: 'channel_product',
      entityId: row.id,
      before: existing
        ? { status: existing.status, priceOverride: existing.priceOverride }
        : null,
      after: { status: row.status, priceOverride: row.priceOverride, externalId: row.externalId },
      ip: ip(c),
    });
    return { row, action };
  });

  logger.info(
    { channelId: id, variantId, action: result.action, actor: user.id },
    'channel_product upserted',
  );
  return c.json(
    {
      channelProduct: toChannelProductDto(result.row, {
        id: variant.productId,
        title: variant.productTitle,
        sku: variant.sku,
      }),
    },
    result.action === 'create' ? 201 : 200,
  );
});

// ─── GET /api/channels/:id/orders ────────────────────────────

channelRoutes.get('/:id/orders', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [channel] = await db.select({ id: channels.id }).from(channels).where(eq(channels.id, id)).limit(1);
  if (!channel) return c.json({ error: 'channel_not_found' }, 404);

  const rows = await db
    .select()
    .from(channelOrders)
    .where(eq(channelOrders.channelId, id))
    .orderBy(desc(channelOrders.importedAt));

  return c.json({ channelId: id, items: rows.map(toChannelOrderDto), total: rows.length });
});

// De idempotente sync-helpers (upsertChannelOrder / upsertChannelProduct /
// availableForVariant) zijn naar ./sync.ts verhuisd, zodat de scheduler exact
// dezelfde sync-kern hergebruikt. Zie runChannelSync().
