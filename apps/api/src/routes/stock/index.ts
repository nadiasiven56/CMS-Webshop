/**
 * Stock-router — `/api/stock/*`.
 *
 * Endpoints:
 *   GET  /api/stock                 — overview: paginated lijst van inventory_items
 *                                     met aggregated totals over alle locations.
 *   GET  /api/stock/:itemId         — detail met breakdown per location.
 *   POST /api/stock/:itemId/adjust  — handmatige stock-adjustment (transactional).
 *
 * Alle endpoints achter `requireAuth`. Schrijf-endpoints lopen door
 * `runInTransactionWithAudit` zodat `audit_log` automatisch geschreven wordt.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, or, sql, count } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { inventoryItems } from '../../db/schema/inventory-items.js';
import { inventoryLevels } from '../../db/schema/inventory-levels.js';
import { inventoryMovements } from '../../db/schema/inventory-movements.js';
import { variants } from '../../db/schema/variants.js';
import { products } from '../../db/schema/products.js';
import { locations } from '../../db/schema/locations.js';
import {
  applyDeltaAndRecompute,
  NegativeStockError,
} from '../../domain/stock/available-recompute.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';

export const stockRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles
stockRoutes.use('*', requireAuth);

// ─── Validation schemas ──────────────────────────────────────

const overviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().min(1).optional(),
  sort: z
    .enum(['sku_asc', 'sku_desc', 'available_asc', 'available_desc', 'on_hand_asc', 'on_hand_desc'])
    .default('sku_asc'),
  /** Toon alleen items waar enige location available < min_stock. */
  lowStockOnly: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

const ALLOWED_REASONS = [
  'receive',
  'damage',
  'loss',
  'audit',
  'manual',
  'adjust',
] as const;

const adjustBodySchema = z.object({
  location_id: z.string().uuid(),
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0, { message: 'delta cannot be zero' }),
  reason: z.string().trim().min(1).max(64),
  note: z.string().trim().max(1000).optional(),
});

const adjustQuerySchema = z.object({
  force: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

// ─── GET /api/stock — overview ───────────────────────────────

stockRoutes.get('/', async (c) => {
  const parsed = overviewQuerySchema.safeParse({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
    search: c.req.query('search'),
    sort: c.req.query('sort'),
    lowStockOnly: c.req.query('lowStockOnly'),
  });
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { page, pageSize, search, sort, lowStockOnly } = parsed.data;

  // Aggregated totals per item via 1 round-trip:
  //   - sum(on_hand), sum(available), sum(committed), sum(incoming)
  //   - count(distinct location_id) -> locations_count
  //   - bool_or(min_stock IS NOT NULL AND available < min_stock) -> low_stock
  //
  // Title komt uit products via variant. We joinen items -> variants -> products.
  const onHandSum = sql<number>`coalesce(sum(${inventoryLevels.onHand}), 0)::int`;
  const availableSum = sql<number>`coalesce(sum(${inventoryLevels.available}), 0)::int`;
  const committedSum = sql<number>`coalesce(sum(${inventoryLevels.committed}), 0)::int`;
  const incomingSum = sql<number>`coalesce(sum(${inventoryLevels.incoming}), 0)::int`;
  const locationsCount = sql<number>`count(distinct ${inventoryLevels.locationId})::int`;
  const lowStockFlag = sql<boolean>`bool_or(${inventoryLevels.minStock} is not null and ${inventoryLevels.available} < ${inventoryLevels.minStock})`;

  // Where-clause
  const whereParts = [];
  if (search) {
    const term = `%${search}%`;
    whereParts.push(
      or(
        ilike(inventoryItems.sku, term),
        ilike(products.title, term),
        ilike(variants.sku, term),
      ),
    );
  }
  const whereExpr = whereParts.length > 0 ? and(...whereParts) : undefined;

  // Sort-mapping
  const sortColumn = (() => {
    switch (sort) {
      case 'sku_asc':
        return asc(inventoryItems.sku);
      case 'sku_desc':
        return desc(inventoryItems.sku);
      case 'available_asc':
        return asc(availableSum);
      case 'available_desc':
        return desc(availableSum);
      case 'on_hand_asc':
        return asc(onHandSum);
      case 'on_hand_desc':
        return desc(onHandSum);
      default:
        return asc(inventoryItems.sku);
    }
  })();

  // Build base query
  let q = db
    .select({
      itemId: inventoryItems.id,
      sku: inventoryItems.sku,
      tracked: inventoryItems.tracked,
      variantId: variants.id,
      variantSku: variants.sku,
      productId: products.id,
      productTitle: products.title,
      productStatus: products.status,
      onHandTotal: onHandSum,
      availableTotal: availableSum,
      committedTotal: committedSum,
      incomingTotal: incomingSum,
      locationsCount,
      lowStock: lowStockFlag,
    })
    .from(inventoryItems)
    .leftJoin(variants, eq(variants.id, inventoryItems.variantId))
    .leftJoin(products, eq(products.id, variants.productId))
    .leftJoin(inventoryLevels, eq(inventoryLevels.itemId, inventoryItems.id))
    .groupBy(inventoryItems.id, variants.id, products.id)
    .$dynamic();

  if (whereExpr) q = q.where(whereExpr);

  // Apply having-clause for low-stock filter
  if (lowStockOnly) {
    q = q.having(
      sql`bool_or(${inventoryLevels.minStock} is not null and ${inventoryLevels.available} < ${inventoryLevels.minStock})`,
    );
  }

  q = q.orderBy(sortColumn).limit(pageSize).offset((page - 1) * pageSize);

  const items = await q;

  // Total-count voor pagination — separate count(distinct id) query.
  const totalQuery = db
    .select({ total: count(inventoryItems.id) })
    .from(inventoryItems)
    .leftJoin(variants, eq(variants.id, inventoryItems.variantId))
    .leftJoin(products, eq(products.id, variants.productId))
    .$dynamic();
  const totalRow = await (whereExpr ? totalQuery.where(whereExpr) : totalQuery);
  const total = totalRow[0]?.total ?? 0;

  return c.json({
    items: items.map((row) => ({
      itemId: row.itemId,
      sku: row.sku,
      tracked: row.tracked,
      variantId: row.variantId,
      variantSku: row.variantSku,
      productId: row.productId,
      productTitle: row.productTitle,
      productStatus: row.productStatus,
      onHandTotal: Number(row.onHandTotal ?? 0),
      availableTotal: Number(row.availableTotal ?? 0),
      committedTotal: Number(row.committedTotal ?? 0),
      incomingTotal: Number(row.incomingTotal ?? 0),
      locationsCount: Number(row.locationsCount ?? 0),
      lowStock: Boolean(row.lowStock),
    })),
    page,
    pageSize,
    total: Number(total),
  });
});

// ─── GET /api/stock/:itemId — detail ─────────────────────────

stockRoutes.get('/:itemId', async (c) => {
  const itemId = c.req.param('itemId');
  if (!isUuid(itemId)) {
    return c.json({ error: 'invalid_item_id' }, 400);
  }

  // Header: item + variant + product
  const [header] = await db
    .select({
      itemId: inventoryItems.id,
      sku: inventoryItems.sku,
      tracked: inventoryItems.tracked,
      requiresShipping: inventoryItems.requiresShipping,
      gtin: inventoryItems.gtin,
      hsCode: inventoryItems.hsCode,
      countryOfOrigin: inventoryItems.countryOfOrigin,
      variantId: variants.id,
      variantSku: variants.sku,
      productId: products.id,
      productTitle: products.title,
      productStatus: products.status,
    })
    .from(inventoryItems)
    .leftJoin(variants, eq(variants.id, inventoryItems.variantId))
    .leftJoin(products, eq(products.id, variants.productId))
    .where(eq(inventoryItems.id, itemId))
    .limit(1);

  if (!header) {
    return c.json({ error: 'item_not_found' }, 404);
  }

  // Per-location levels — left-join op locations zodat we ook locations met
  // 0-row als optie zien? Nee: V1 toont alleen locations waar al een level-row
  // bestaat. Adjust kan een nieuwe (item, location)-paar aanmaken.
  const levels = await db
    .select({
      locationId: locations.id,
      locationCode: locations.code,
      locationName: locations.name,
      locationType: locations.type,
      onHand: inventoryLevels.onHand,
      available: inventoryLevels.available,
      committed: inventoryLevels.committed,
      incoming: inventoryLevels.incoming,
      minStock: inventoryLevels.minStock,
      reorderPoint: inventoryLevels.reorderPoint,
      reorderQty: inventoryLevels.reorderQty,
      updatedAt: inventoryLevels.updatedAt,
    })
    .from(inventoryLevels)
    .innerJoin(locations, eq(locations.id, inventoryLevels.locationId))
    .where(eq(inventoryLevels.itemId, itemId))
    .orderBy(asc(locations.priority), asc(locations.code));

  // Recente movements — laatste 10
  const recentMovements = await db
    .select({
      id: inventoryMovements.id,
      delta: inventoryMovements.delta,
      reason: inventoryMovements.reason,
      refType: inventoryMovements.refType,
      refId: inventoryMovements.refId,
      actorId: inventoryMovements.actorId,
      note: inventoryMovements.note,
      createdAt: inventoryMovements.createdAt,
      locationId: locations.id,
      locationCode: locations.code,
      locationName: locations.name,
    })
    .from(inventoryMovements)
    .innerJoin(locations, eq(locations.id, inventoryMovements.locationId))
    .where(eq(inventoryMovements.itemId, itemId))
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(10);

  // Aggregates over alle locations
  const onHandTotal = levels.reduce((acc, l) => acc + l.onHand, 0);
  const availableTotal = levels.reduce((acc, l) => acc + l.available, 0);
  const committedTotal = levels.reduce((acc, l) => acc + l.committed, 0);
  const incomingTotal = levels.reduce((acc, l) => acc + l.incoming, 0);

  return c.json({
    itemId: header.itemId,
    sku: header.sku,
    tracked: header.tracked,
    requiresShipping: header.requiresShipping,
    gtin: header.gtin,
    hsCode: header.hsCode,
    countryOfOrigin: header.countryOfOrigin,
    variant: header.variantId
      ? {
          id: header.variantId,
          sku: header.variantSku,
        }
      : null,
    product: header.productId
      ? {
          id: header.productId,
          title: header.productTitle,
          status: header.productStatus,
        }
      : null,
    totals: {
      onHand: onHandTotal,
      available: availableTotal,
      committed: committedTotal,
      incoming: incomingTotal,
    },
    locations: levels.map((l) => ({
      locationId: l.locationId,
      code: l.locationCode,
      name: l.locationName,
      type: l.locationType,
      onHand: l.onHand,
      available: l.available,
      committed: l.committed,
      incoming: l.incoming,
      minStock: l.minStock,
      reorderPoint: l.reorderPoint,
      reorderQty: l.reorderQty,
      lowStock: l.minStock != null && l.available < l.minStock,
      updatedAt: l.updatedAt,
    })),
    recentMovements: recentMovements.map((m) => ({
      id: m.id,
      delta: m.delta,
      reason: m.reason,
      refType: m.refType,
      refId: m.refId,
      actorId: m.actorId,
      note: m.note,
      createdAt: m.createdAt,
      location: {
        id: m.locationId,
        code: m.locationCode,
        name: m.locationName,
      },
    })),
  });
});

// ─── POST /api/stock/:itemId/adjust ──────────────────────────

stockRoutes.post('/:itemId/adjust', async (c) => {
  const itemId = c.req.param('itemId');
  if (!isUuid(itemId)) {
    return c.json({ error: 'invalid_item_id' }, 400);
  }
  const user = c.get('user');

  const body = await c.req.json().catch(() => null);
  const parsedBody = adjustBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return c.json({ error: 'invalid_request', details: parsedBody.error.flatten() }, 400);
  }
  const parsedQuery = adjustQuerySchema.safeParse({ force: c.req.query('force') });
  if (!parsedQuery.success) {
    return c.json({ error: 'invalid_request', details: parsedQuery.error.flatten() }, 400);
  }

  const { location_id, delta, reason, note } = parsedBody.data;
  const { force } = parsedQuery.data;

  // Pre-check existence van item + location (snel, zonder transaction).
  const [itemRow] = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .limit(1);
  if (!itemRow) {
    return c.json({ error: 'item_not_found' }, 404);
  }
  const [locationRow] = await db
    .select({ id: locations.id, active: locations.active })
    .from(locations)
    .where(eq(locations.id, location_id))
    .limit(1);
  if (!locationRow) {
    return c.json({ error: 'location_not_found' }, 404);
  }
  if (!locationRow.active) {
    return c.json({ error: 'location_inactive' }, 422);
  }

  try {
    const result = await runInTransactionWithAudit(async (tx, audit) => {
      // 1. Update inventory_levels (creëert row als hij nog niet bestaat)
      const newLevel = await applyDeltaAndRecompute(tx, {
        itemId,
        locationId: location_id,
        delta,
        force,
      });

      // 2. Schrijf inventory_movements row
      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          itemId,
          locationId: location_id,
          delta,
          reason,
          refType: 'manual',
          refId: null,
          actorId: user.id,
          note: note ?? null,
        })
        .returning();

      // 3. Audit-log
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'adjust',
        entityType: 'inventory_movement',
        entityId: movement?.id ?? null,
        before: null,
        after: {
          itemId,
          locationId: location_id,
          delta,
          reason,
          note: note ?? null,
          newOnHand: newLevel.onHand,
          newAvailable: newLevel.available,
          force: force ? true : undefined,
        },
        ip: c.req.header('x-forwarded-for') ?? null,
      });

      return { newLevel, movement };
    });

    logger.info(
      {
        itemId,
        locationId: location_id,
        delta,
        reason,
        actor: user.id,
        force,
        newOnHand: result.newLevel.onHand,
      },
      'stock adjust ok',
    );

    return c.json({
      ok: true,
      level: {
        itemId: result.newLevel.itemId,
        locationId: result.newLevel.locationId,
        onHand: result.newLevel.onHand,
        available: result.newLevel.available,
        committed: result.newLevel.committed,
        incoming: result.newLevel.incoming,
      },
      movement: result.movement
        ? {
            id: result.movement.id,
            delta: result.movement.delta,
            reason: result.movement.reason,
            createdAt: result.movement.createdAt,
          }
        : null,
    });
  } catch (err) {
    if (err instanceof NegativeStockError) {
      return c.json(
        {
          error: 'negative_stock',
          message: err.message,
          currentOnHand: err.currentOnHand,
          delta: err.delta,
        },
        422,
      );
    }
    logger.error({ err, itemId, location_id }, 'stock adjust failed');
    throw err;
  }
});

// ─── helpers ─────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string | undefined | null): v is string {
  return typeof v === 'string' && UUID_REGEX.test(v);
}

// silence unused-import warnings if any reason-list is later added
void ALLOWED_REASONS;
