/**
 * GET /api/customers — paginate + filter (shop-scoped).
 *
 * Query:
 *   shopId uuid          (optioneel — filter op shop)
 *   search string        (ilike op email / first_name / last_name / company)
 *   limit  number 1..100 (default 20)
 *   offset number >=0    (default 0)
 *
 * Order: updated_at desc.
 *
 * 200 { items: CustomerDto[], total, limit, offset }
 * 400 invalid_request
 */
import type { Context } from 'hono';
import { and, desc, eq, ilike, or, count, inArray } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { customers } from '../../db/schema/index.js';
import { accessibleShopIds } from '../../lib/access.js';
import { CustomerListQuerySchema } from './_schemas.js';
import { toCustomerDto } from './_serialize.js';

export async function listCustomers(c: Context): Promise<Response> {
  const parsed = CustomerListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { shopId, search, limit, offset } = parsed.data;

  // Multi-user: non-admin ziet alleen member-shops (null = admin/onbeperkt).
  const memberShopIds = await accessibleShopIds(c.get('user'));

  const conditions = [];
  if (shopId) {
    // Expliciet shop-filter: alleen toegankelijke shop — anders 404 (geen leak).
    if (memberShopIds && !memberShopIds.includes(shopId)) {
      return c.json({ error: 'not_found' }, 404);
    }
    conditions.push(eq(customers.shopId, shopId));
  } else if (memberShopIds) {
    // Lege lijst → inArray rendert `false` → lege resultaten.
    conditions.push(inArray(customers.shopId, memberShopIds));
  }
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(customers.email, pattern),
        ilike(customers.firstName, pattern),
        ilike(customers.lastName, pattern),
        ilike(customers.company, pattern),
      ),
    );
  }
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(customers)
    .orderBy(desc(customers.updatedAt))
    .limit(limit)
    .offset(offset);
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const totalQuery = db.select({ c: count() }).from(customers);
  const totalRes = whereExpr ? await totalQuery.where(whereExpr) : await totalQuery;
  const total = Number(totalRes[0]?.c ?? 0);

  return c.json({
    items: rows.map(toCustomerDto),
    total,
    limit,
    offset,
  });
}
