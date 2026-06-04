/**
 * Dashboard-router — `/api/dashboard/*`. Achter `requireAuth`.
 *
 * Endpoints:
 *   GET /api/dashboard/kpis?shop_id&channel&from&to
 *       → DashboardKpis (EXACT de admin-shape, zie _serialize.ts +
 *         apps/admin/src/lib/mock-data.ts). De admin consumeert deze response
 *         1-op-1 zonder code-wijziging.
 *
 * Aggregaties:
 *   - revenue30d / revenueSeries / topProducts → uit `orders` (+ `order_items`),
 *     alleen betaalde/(deels-)gerefunde orders. Alle sommen in HELE CENTEN via
 *     `toCents` → geen float-drift. `subtotal` = omzet net (excl. BTW).
 *   - openOrders / unpaid / toShip → counts op order-status.
 *   - lowStock → uit `inventory_levels` (available < min_stock).
 *   - channels → uit de echte `channels`-tabel (status + last_sync_at).
 *   - recentActivity → recente `audit_log`-rijen.
 *
 * `shop_id` weglaten = aggregeer over ALLE shops. `from`/`to` overschrijven het
 * default 30-daags venster (channel/low-stock/activity zijn niet shop-gefilterd
 * tenzij relevant — channels/audit zijn globaal in V1).
 *
 * Wired in routes/index.ts door de finalizer — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { and, desc, eq, gte, lte, inArray, sql } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { orders } from '../../db/schema/orders.js';
import { orderItems } from '../../db/schema/order-items.js';
import { inventoryItems } from '../../db/schema/inventory-items.js';
import { inventoryLevels } from '../../db/schema/inventory-levels.js';
import { variants } from '../../db/schema/variants.js';
import { products } from '../../db/schema/products.js';
import { channels } from '../../db/schema/channels.js';
import { auditLog } from '../../db/schema/audit-log.js';
import { toCents } from '../../domain/finance/vat-math.js';
import { KpiQuerySchema } from './_schemas.js';
import { auditRowToActivity, buildKpis, type KpiAggregates } from './_serialize.js';

export const dashboardRoutes = new Hono<{ Variables: AuthVariables }>();

dashboardRoutes.use('*', requireAuth);

/** 'YYYY-MM-DD' voor een Date (UTC-dag, consistent met de date-buckets). */
function dayLabel(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Financiele statussen die als gerealiseerde omzet meetellen. */
const REVENUE_STATUSES = ['paid', 'partially_refunded', 'refunded'] as const;

dashboardRoutes.get('/kpis', async (c) => {
  const parsed = KpiQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { shop_id, channel, from, to } = parsed.data;

  const now = new Date();

  // ── Venster bepalen ────────────────────────────────────────
  // Default = laatste 30 dagen (inclusief vandaag). from/to overschrijven.
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : now;
  const fromDate = from
    ? new Date(`${from}T00:00:00.000Z`)
    : new Date(toDate.getTime() - 29 * 24 * 3600 * 1000);

  // Dag-labels voor de serie (oudste → nieuwste), gecapt op ~92 dagen.
  const spanDays = Math.min(
    92,
    Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 3600 * 1000)) + 1),
  );
  const days: string[] = [];
  for (let i = spanDays - 1; i >= 0; i--) {
    days.push(dayLabel(new Date(toDate.getTime() - i * 24 * 3600 * 1000)));
  }

  // Vorige periode (zelfde lengte, direct ervoor) voor de delta.
  const prevToDate = new Date(fromDate.getTime() - 1);
  const prevFromDate = new Date(prevToDate.getTime() - (spanDays - 1) * 24 * 3600 * 1000);

  // ── Gedeelde order-filter ──────────────────────────────────
  const orderConds = [inArray(orders.financialStatus, [...REVENUE_STATUSES])];
  if (shop_id) orderConds.push(eq(orders.shopId, shop_id));
  if (channel) orderConds.push(eq(orders.channel, channel));

  const windowConds = [
    ...orderConds,
    gte(orders.createdAt, sql`${fromDate.toISOString()}::timestamptz`),
    lte(orders.createdAt, sql`${toDate.toISOString()}::timestamptz`),
  ];

  // ── Revenue per dag (centen) ───────────────────────────────
  const dayBucket = sql<string>`to_char(${orders.createdAt}::date, 'YYYY-MM-DD')`;
  const revenueRows = await db
    .select({
      day: dayBucket,
      subtotal: sql<string>`coalesce(sum(${orders.subtotal}), 0)`,
    })
    .from(orders)
    .where(and(...windowConds))
    .groupBy(dayBucket);

  const revenueByDayCents = new Map<string, number>();
  for (const r of revenueRows) {
    revenueByDayCents.set(r.day, toCents(r.subtotal));
  }

  // ── Vorige-periode omzet (centen) voor delta ───────────────
  const [prevRow] = await db
    .select({ subtotal: sql<string>`coalesce(sum(${orders.subtotal}), 0)` })
    .from(orders)
    .where(
      and(
        ...orderConds,
        gte(orders.createdAt, sql`${prevFromDate.toISOString()}::timestamptz`),
        lte(orders.createdAt, sql`${prevToDate.toISOString()}::timestamptz`),
      ),
    );
  const prevRevenueCents = toCents(prevRow?.subtotal);

  // ── Open orders + onderverdeling ───────────────────────────
  // "open" = nog niet afgehandeld (niet delivered/cancelled/refunded).
  const openConds = [
    sql`${orders.status} not in ('delivered','cancelled','refunded')`,
  ];
  if (shop_id) openConds.push(eq(orders.shopId, shop_id));
  if (channel) openConds.push(eq(orders.channel, channel));

  const [openCounts] = await db
    .select({
      openOrders: sql<number>`count(*)::int`,
      openOrdersUnpaid: sql<number>`count(*) filter (where ${orders.financialStatus} = 'pending')::int`,
      openOrdersToShip: sql<number>`count(*) filter (where ${orders.fulfillmentStatus} <> 'shipped' and ${orders.fulfillmentStatus} <> 'fulfilled')::int`,
    })
    .from(orders)
    .where(and(...openConds));

  // ── Low stock ──────────────────────────────────────────────
  // available < min_stock op level-niveau. Top-3 op laagste available.
  const lowStockRows = await db
    .select({
      sku: inventoryItems.sku,
      productTitle: products.title,
      available: inventoryLevels.available,
    })
    .from(inventoryLevels)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryLevels.itemId))
    .leftJoin(variants, eq(variants.id, inventoryItems.variantId))
    .leftJoin(products, eq(products.id, variants.productId))
    .where(
      sql`${inventoryLevels.minStock} is not null and ${inventoryLevels.available} < ${inventoryLevels.minStock}`,
    );

  const lowStockCount = lowStockRows.length;
  const lowStockTop = [...lowStockRows]
    .sort((a, b) => a.available - b.available)
    .slice(0, 3)
    .map((r) => ({
      sku: r.sku,
      available: r.available,
      productTitle: r.productTitle ?? r.sku,
    }));

  // ── Top producten op omzet (centen) ────────────────────────
  const topProductRows = await db
    .select({
      title: sql<string>`coalesce(${orderItems.title}, ${orderItems.sku}, 'Onbekend')`,
      revenue: sql<string>`coalesce(sum(${orderItems.lineTotal}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(...windowConds))
    .groupBy(sql`coalesce(${orderItems.title}, ${orderItems.sku}, 'Onbekend')`)
    .orderBy(desc(sql`sum(${orderItems.lineTotal})`))
    .limit(5);

  const topProductsCents = topProductRows.map((r) => ({
    title: r.title,
    revenueCents: toCents(r.revenue),
  }));

  // ── Channels (echte tabel) ─────────────────────────────────
  const channelRows = await db
    .select({
      name: channels.name,
      status: channels.status,
      lastSyncAt: channels.lastSyncAt,
    })
    .from(channels)
    .orderBy(channels.name);

  // ── Recent activity (audit_log) ────────────────────────────
  const auditRows = await db
    .select({
      id: auditLog.id,
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      action: auditLog.action,
      entityType: auditLog.entityType,
      ts: auditLog.ts,
    })
    .from(auditLog)
    .orderBy(desc(auditLog.ts))
    .limit(10);

  const aggregates: KpiAggregates = {
    revenueByDayCents,
    prevRevenueCents,
    days,
    openOrders: Number(openCounts?.openOrders ?? 0),
    openOrdersUnpaid: Number(openCounts?.openOrdersUnpaid ?? 0),
    openOrdersToShip: Number(openCounts?.openOrdersToShip ?? 0),
    lowStockCount,
    lowStockTop,
    topProductsCents,
    channels: channelRows,
    recentActivity: auditRows.map(auditRowToActivity),
  };

  logger.debug({ shop_id, channel, from, to, spanDays }, 'dashboard kpis computed');
  return c.json(buildKpis(aggregates, now));
});
