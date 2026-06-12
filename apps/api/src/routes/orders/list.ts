/**
 * GET /api/orders — paginated lijst met filters.
 *
 * Query: shop_id, status, financial_status, fulfillment_status, channel,
 *        search (order_number / email), limit, offset.
 * Order: created_at desc.
 *
 * Response: { items: OrderListItem[], total, limit, offset }
 *   OrderListItem = order-core + itemCount + customerName.
 */
import type { Context } from 'hono';
import { and, desc, eq, ilike, or, count, inArray } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { orders } from '../../db/schema/orders.js';
import { orderItems } from '../../db/schema/order-items.js';
import { customers } from '../../db/schema/customers.js';
import { accessibleShopIds } from '../../lib/access.js';
import { ListQuerySchema } from './_schemas.js';
import { toOrderCore } from './_serialize.js';

export async function listOrders(c: Context): Promise<Response> {
  const user = c.get('user');
  const parsed = ListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { shop_id, status, financial_status, fulfillment_status, channel, search, limit, offset } =
    parsed.data;

  // Multi-user: non-admin ziet alleen member-shops (null = admin/onbeperkt).
  const memberShopIds = await accessibleShopIds(user);

  const conditions = [];
  if (shop_id) {
    // Expliciet shop-filter: alleen als die shop toegankelijk is — anders 404
    // (zelfde shape als not-found, voorkomt existence-leak).
    if (memberShopIds && !memberShopIds.includes(shop_id)) {
      return c.json({ error: 'not_found' }, 404);
    }
    conditions.push(eq(orders.shopId, shop_id));
  } else if (memberShopIds) {
    // Lege lijst → inArray rendert `false` → lege resultaten.
    conditions.push(inArray(orders.shopId, memberShopIds));
  }
  if (status) conditions.push(eq(orders.status, status));
  if (financial_status) conditions.push(eq(orders.financialStatus, financial_status));
  if (fulfillment_status) conditions.push(eq(orders.fulfillmentStatus, fulfillment_status));
  if (channel) conditions.push(eq(orders.channel, channel));
  if (search) {
    const term = `%${search}%`;
    conditions.push(or(ilike(orders.orderNumber, term), ilike(orders.email, term)));
  }
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(orders)
    .orderBy(desc(orders.createdAt))
    .limit(limit)
    .offset(offset);
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const totalQuery = db.select({ c: count() }).from(orders);
  const totalRes = whereExpr ? await totalQuery.where(whereExpr) : await totalQuery;
  const total = Number(totalRes[0]?.c ?? 0);

  // item-counts + customer-namen voor de zichtbare set
  const orderIds = rows.map((r) => r.id);
  const customerIds = rows.map((r) => r.customerId).filter((x): x is string => !!x);

  const itemCountByOrder = new Map<string, number>();
  const customerNameById = new Map<string, string>();

  if (orderIds.length > 0) {
    const itemCounts = await db
      .select({ orderId: orderItems.orderId, c: count() })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))
      .groupBy(orderItems.orderId);
    for (const r of itemCounts) itemCountByOrder.set(r.orderId, Number(r.c));
  }
  if (customerIds.length > 0) {
    const custRows = await db
      .select({ id: customers.id, firstName: customers.firstName, lastName: customers.lastName })
      .from(customers)
      .where(inArray(customers.id, customerIds));
    for (const cu of custRows) {
      const name = [cu.firstName, cu.lastName].filter(Boolean).join(' ').trim();
      customerNameById.set(cu.id, name);
    }
  }

  const items = rows.map((o) => ({
    ...toOrderCore(o),
    itemCount: itemCountByOrder.get(o.id) ?? 0,
    customerName: o.customerId ? customerNameById.get(o.customerId) ?? null : null,
  }));

  return c.json({ items, total, limit, offset });
}
