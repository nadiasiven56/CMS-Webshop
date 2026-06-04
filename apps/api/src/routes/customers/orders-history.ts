/**
 * GET /api/customers/:id/orders — read-only order-historie per klant.
 *
 * Belangrijk: dit dupliceert de orders-routes NIET. Het is een enkele
 * select-projectie op de `orders`-tabel, gefilterd op customer_id, voor de
 * klant-detail-view. Writes/transities horen in routes/orders (Agent 3).
 *
 * Query: limit (1..100, default 50), offset (>=0, default 0).
 *
 * 200 { items: CustomerOrderDto[], total, limit, offset }
 * 400 invalid_id / invalid_request
 * 404 not_found (klant bestaat niet)
 */
import type { Context } from 'hono';
import { desc, eq, count } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { customers, orders } from '../../db/schema/index.js';
import { OrdersHistoryQuerySchema } from './_schemas.js';
import { toCustomerOrderDto } from './_serialize.js';
import { isUuid } from './_validate.js';

export async function listCustomerOrders(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const parsed = OrdersHistoryQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset } = parsed.data;

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!customer) {
    return c.json({ error: 'not_found' }, 404);
  }

  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.customerId, id))
    .orderBy(desc(orders.createdAt))
    .limit(limit)
    .offset(offset);

  const totalRes = await db
    .select({ c: count() })
    .from(orders)
    .where(eq(orders.customerId, id));
  const total = Number(totalRes[0]?.c ?? 0);

  return c.json({
    items: rows.map(toCustomerOrderDto),
    total,
    limit,
    offset,
  });
}
