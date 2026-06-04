/**
 * Analytics-router — `/api/analytics/*`. Achter `requireAuth`.
 *
 * Read-only business-intelligence over BESTAANDE tabellen (orders / order_items
 * / products / variants / channels / shops / customers / inventory_*). GEEN
 * schema, GEEN migratie, GEEN writes. Bedoeld om in de admin echte grafieken te
 * voeden (omzet-over-tijd, best-sellers, AOV, kanaal/shop-verdeling,
 * low-stock-reorder, top-klanten).
 *
 * Conventies (overgenomen van dashboard/finance):
 *   - "geldige/betaalde order" = financial_status ∈ {paid, partially_refunded,
 *     refunded} (zie _queries.REVENUE_STATUSES).
 *   - Geld komt als numeric(12,4)-string; we sommeren in HELE CENTEN
 *     (vat-math.toCents) → geen float-drift, en geven Money-STRINGS terug
 *     (centsToMoney → '1234.5600').
 *   - Omzet = `orders.subtotal` (NET, excl. BTW) op order-niveau, en
 *     `order_items.line_total` op regel-niveau (top-products/top-customers via
 *     items, breakdowns via order-totalen) — exact zoals het dashboard.
 *   - Datum-filter op `orders.created_at`; venster default = laatste 30 dagen.
 *   - shop_id weglaten = alle shops. Filters consistent via buildFilters(q).
 *
 * Alle user-input gaat via bound parameters; alleen de gevalideerde `interval`-
 * enum gaat als raw literal in date_trunc (zie _queries.periodBucket).
 *
 * Wired in routes/index.ts door de orchestrator — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { orders } from '../../db/schema/orders.js';
import { orderItems } from '../../db/schema/order-items.js';
import { products } from '../../db/schema/products.js';
import { variants } from '../../db/schema/variants.js';
import { channels } from '../../db/schema/channels.js';
import { shops } from '../../db/schema/shops.js';
import { customers } from '../../db/schema/customers.js';
import { inventoryItems } from '../../db/schema/inventory-items.js';
import { inventoryLevels } from '../../db/schema/inventory-levels.js';
import { toCents, centsToMoney } from '../../domain/finance/vat-math.js';
import {
  SalesOverTimeQuerySchema,
  TopProductsQuerySchema,
  KpisQuerySchema,
  BreakdownQuerySchema,
  LowStockQuerySchema,
  TopCustomersQuerySchema,
} from './_schemas.js';
import { buildFilters, buildOrderConds, periodBucket } from './_queries.js';

export const analyticsRoutes = new Hono<{ Variables: AuthVariables }>();

analyticsRoutes.use('*', requireAuth);

/** Aandeel (0..1, 4 decimalen) van een deel t.o.v. totaal; 0 bij totaal 0. */
function share(partCents: number, totalCents: number): number {
  if (totalCents <= 0) return 0;
  return Math.round((partCents / totalCents) * 10000) / 10000;
}

// ════════════════════════════════════════════════════════════════
// GET /sales-over-time
//   Omzet/orders/units per interval-bucket over het venster.
// ════════════════════════════════════════════════════════════════
analyticsRoutes.get('/sales-over-time', async (c) => {
  const parsed = SalesOverTimeQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const q = parsed.data;
  const { where } = buildFilters(q);
  const bucket = periodBucket(q.interval);

  // Revenue (subtotal, net) + order-count per bucket — uit orders.
  const revenueRows = await db
    .select({
      period: bucket,
      orders: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${orders.subtotal}), 0)`,
    })
    .from(orders)
    .where(where)
    .groupBy(bucket)
    .orderBy(bucket);

  // Units per bucket — via order_items (join terug naar dezelfde order-filter).
  const unitBucket = sql<string>`to_char(date_trunc('${sql.raw(q.interval)}', ${orders.createdAt}::timestamp), 'YYYY-MM-DD')`;
  const unitRows = await db
    .select({
      period: unitBucket,
      units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(where)
    .groupBy(unitBucket)
    .orderBy(unitBucket);

  const unitsByPeriod = new Map<string, number>();
  for (const r of unitRows) unitsByPeriod.set(r.period, Number(r.units));

  let totalRevenueCents = 0;
  let totalOrders = 0;
  let totalUnits = 0;
  const series = revenueRows.map((r) => {
    const cents = toCents(r.revenue);
    const units = unitsByPeriod.get(r.period) ?? 0;
    totalRevenueCents += cents;
    totalOrders += Number(r.orders);
    totalUnits += units;
    return {
      period: r.period,
      orders: Number(r.orders),
      revenue: centsToMoney(cents),
      units,
    };
  });

  return c.json({
    series,
    totals: {
      orders: totalOrders,
      revenue: centsToMoney(totalRevenueCents),
      units: totalUnits,
    },
    interval: q.interval,
  });
});

// ════════════════════════════════════════════════════════════════
// GET /top-products?limit=10
//   Best-sellers op omzet, via order_items → variants → products.
// ════════════════════════════════════════════════════════════════
analyticsRoutes.get('/top-products', async (c) => {
  const parsed = TopProductsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const q = parsed.data;
  const { where } = buildFilters(q);

  // Groepeer op variant (productId via variants-join). variant_id kan null zijn
  // op historische regels → die vallen onder een 'losse' groep per sku/title.
  const rows = await db
    .select({
      productId: products.id,
      variantId: orderItems.variantId,
      title: sql<string>`coalesce(${products.title}, ${orderItems.title}, ${orderItems.sku}, 'Onbekend')`,
      sku: sql<string>`coalesce(${variants.sku}, ${orderItems.sku})`,
      unitsSold: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
      revenue: sql<string>`coalesce(sum(${orderItems.lineTotal}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(variants, eq(variants.id, orderItems.variantId))
    .leftJoin(products, eq(products.id, variants.productId))
    .where(where)
    .groupBy(
      orderItems.variantId,
      products.id,
      products.title,
      variants.sku,
      orderItems.title,
      orderItems.sku,
    )
    .orderBy(desc(sql`sum(${orderItems.lineTotal})`))
    .limit(q.limit);

  const items = rows.map((r) => ({
    productId: r.productId ?? null,
    variantId: r.variantId ?? null,
    title: r.title,
    sku: r.sku ?? null,
    unitsSold: Number(r.unitsSold),
    revenue: centsToMoney(toCents(r.revenue)),
  }));

  return c.json({ items });
});

// ════════════════════════════════════════════════════════════════
// GET /kpis
//   Range-totalen: revenue / orders / aov / units / refunds / newCustomers.
// ════════════════════════════════════════════════════════════════
analyticsRoutes.get('/kpis', async (c) => {
  const parsed = KpisQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const q = parsed.data;
  const { where, conds, window } = buildFilters(q);

  // Revenue (net subtotal) + order-count over het venster.
  const [agg] = await db
    .select({
      revenue: sql<string>`coalesce(sum(${orders.subtotal}), 0)`,
      orders: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(where);

  const revenueCents = toCents(agg?.revenue);
  const orderCount = Number(agg?.orders ?? 0);

  // Units over het venster — via order_items.
  const [unitAgg] = await db
    .select({ units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(where);
  const units = Number(unitAgg?.units ?? 0);

  // Refunds: orders die (deels) gerefund zijn → som van order_items.taxAmount is
  // niet de refund; we benaderen refunds als het verschil tussen grand_total en
  // subtotal is NIET juist. Zonder refund-bedrag-kolom op order nemen we de
  // refund_total als 0 voor 'paid' en als grand_total voor 'refunded' /
  // partial: we hebben geen exact refund-bedrag in V1-schema, dus we
  // rapporteren het bruto bedrag van volledig-gerefunde orders als proxy.
  const refundConds = [...buildOrderConds(q)];
  // Beperk tot refunded/partially_refunded binnen hetzelfde venster.
  const [refundAgg] = await db
    .select({
      refunds: sql<string>`coalesce(sum(case when ${orders.financialStatus} in ('refunded','partially_refunded') then coalesce(${orders.grandTotal}, ${orders.subtotal}, 0) else 0 end), 0)`,
    })
    .from(orders)
    .where(
      and(
        ...refundConds,
        sql`${orders.createdAt} >= ${window.fromDate.toISOString()}::timestamptz`,
        sql`${orders.createdAt} <= ${window.toDate.toISOString()}::timestamptz`,
      ),
    );
  const refundsCents = toCents(refundAgg?.refunds);

  // newCustomers: klanten aangemaakt binnen het venster (+ shop-filter). Channel
  // is geen klant-attribuut, dus daar filteren we niet op.
  const custConds: SQL[] = [
    sql`${customers.createdAt} >= ${window.fromDate.toISOString()}::timestamptz`,
    sql`${customers.createdAt} <= ${window.toDate.toISOString()}::timestamptz`,
  ];
  if (q.shop_id) custConds.push(eq(customers.shopId, q.shop_id));
  const [custAgg] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(customers)
    .where(and(...custConds));
  const newCustomers = Number(custAgg?.n ?? 0);

  // AOV = revenue / orders (centen-deling, guard /0).
  const aovCents = orderCount > 0 ? Math.round(revenueCents / orderCount) : 0;

  return c.json({
    revenue: centsToMoney(revenueCents),
    orders: orderCount,
    aov: centsToMoney(aovCents),
    units,
    refunds: centsToMoney(refundsCents),
    newCustomers,
  });
});

// ════════════════════════════════════════════════════════════════
// GET /channel-breakdown
//   Orders + omzet per kanaal, met aandeel van totale omzet.
// ════════════════════════════════════════════════════════════════
analyticsRoutes.get('/channel-breakdown', async (c) => {
  const parsed = BreakdownQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const q = parsed.data;
  const { where } = buildFilters(q);

  const rows = await db
    .select({
      channel: orders.channel,
      orders: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${orders.subtotal}), 0)`,
    })
    .from(orders)
    .where(where)
    .groupBy(orders.channel)
    .orderBy(desc(sql`sum(${orders.subtotal})`));

  const withCents = rows.map((r) => ({
    channel: r.channel,
    orders: Number(r.orders),
    revenueCents: toCents(r.revenue),
  }));
  const totalCents = withCents.reduce((s, r) => s + r.revenueCents, 0);

  const items = withCents.map((r) => ({
    channel: r.channel,
    orders: r.orders,
    revenue: centsToMoney(r.revenueCents),
    share: share(r.revenueCents, totalCents),
  }));

  return c.json({ items });
});

// ════════════════════════════════════════════════════════════════
// GET /shop-breakdown
//   Orders + omzet per shop (incl. shop-naam), met aandeel.
// ════════════════════════════════════════════════════════════════
analyticsRoutes.get('/shop-breakdown', async (c) => {
  const parsed = BreakdownQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const q = parsed.data;
  const { where } = buildFilters(q);

  const rows = await db
    .select({
      shopId: orders.shopId,
      shopName: shops.name,
      orders: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${orders.subtotal}), 0)`,
    })
    .from(orders)
    .leftJoin(shops, eq(shops.id, orders.shopId))
    .where(where)
    .groupBy(orders.shopId, shops.name)
    .orderBy(desc(sql`sum(${orders.subtotal})`));

  const withCents = rows.map((r) => ({
    shopId: r.shopId,
    shop: r.shopName ?? r.shopId,
    orders: Number(r.orders),
    revenueCents: toCents(r.revenue),
  }));
  const totalCents = withCents.reduce((s, r) => s + r.revenueCents, 0);

  const items = withCents.map((r) => ({
    shopId: r.shopId,
    shop: r.shop,
    orders: r.orders,
    revenue: centsToMoney(r.revenueCents),
    share: share(r.revenueCents, totalCents),
  }));

  return c.json({ items });
});

// ════════════════════════════════════════════════════════════════
// GET /low-stock?threshold=5
//   Voorraad onder drempel + simpele reorder-suggestie. Read-only over
//   inventory_levels (available gesommeerd over locaties per item).
// ════════════════════════════════════════════════════════════════
analyticsRoutes.get('/low-stock', async (c) => {
  const parsed = LowStockQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const q = parsed.data;

  // Available per inventory-item (gesommeerd over alle locaties), gejoind naar
  // variant/product voor titel/sku. Filter op available < threshold in SQL.
  const availExpr = sql<number>`coalesce(sum(${inventoryLevels.available}), 0)::int`;
  const rows = await db
    .select({
      productId: products.id,
      variantId: variants.id,
      title: sql<string>`coalesce(${products.title}, ${inventoryItems.sku}, 'Onbekend')`,
      sku: inventoryItems.sku,
      available: availExpr,
    })
    .from(inventoryItems)
    .leftJoin(inventoryLevels, eq(inventoryLevels.itemId, inventoryItems.id))
    .leftJoin(variants, eq(variants.id, inventoryItems.variantId))
    .leftJoin(products, eq(products.id, variants.productId))
    .groupBy(products.id, variants.id, products.title, inventoryItems.sku)
    .having(sql`coalesce(sum(${inventoryLevels.available}), 0) < ${q.threshold}`)
    .orderBy(availExpr)
    .limit(q.limit);

  const items = rows.map((r) => {
    const available = Number(r.available);
    // Simpele heuristiek: vul aan tot 2× de drempel.
    const reorderSuggested = Math.max(0, q.threshold * 2 - available);
    return {
      productId: r.productId ?? null,
      variantId: r.variantId ?? null,
      title: r.title,
      sku: r.sku,
      available,
      reorderSuggested,
    };
  });

  return c.json({ items, threshold: q.threshold });
});

// ════════════════════════════════════════════════════════════════
// GET /customers/top?limit=10
//   Top-klanten op omzet over het venster (geldige orders).
// ════════════════════════════════════════════════════════════════
analyticsRoutes.get('/customers/top', async (c) => {
  const parsed = TopCustomersQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const q = parsed.data;
  const { where } = buildFilters(q);

  // Groepeer op (customer_id, email). Gasten zonder customer_id vallen samen op
  // hun order-email (coalesce). Omzet = net subtotal van geldige orders.
  const emailExpr = sql<string>`coalesce(${customers.email}, ${orders.email}, 'onbekend')`;
  const rows = await db
    .select({
      customerId: orders.customerId,
      email: emailExpr,
      orders: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${orders.subtotal}), 0)`,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(where)
    .groupBy(orders.customerId, customers.email, orders.email)
    .orderBy(desc(sql`sum(${orders.subtotal})`))
    .limit(q.limit);

  const items = rows.map((r) => ({
    customerId: r.customerId ?? null,
    email: r.email,
    orders: Number(r.orders),
    revenue: centsToMoney(toCents(r.revenue)),
  }));

  return c.json({ items });
});

logger.debug('analytics routes registered');
