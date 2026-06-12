/**
 * DELETE /api/customers/:id — hard-delete.
 *
 * De customers-tabel heeft geen status/soft-delete-kolom. FK-gedrag:
 *   - customer_addresses → cascade (adressen verdwijnen mee)
 *   - orders.customer_id → set null (order-historie blijft, anoniem)
 * Dus hard-delete is veilig en idempotent (404 als al weg).
 *
 * 200 { deleted: true, id }
 * 400 invalid_id
 * 404 not_found
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { customers } from '../../db/schema/index.js';
import { canAccessShop } from '../../lib/access.js';
import { isUuid } from './_validate.js';

export async function deleteCustomer(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }

  // Multi-user: shop niet toegankelijk → zelfde 404 (geen existence-leak).
  const [existing] = await db
    .select({ shopId: customers.shopId })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!existing) {
    return c.json({ error: 'not_found' }, 404);
  }
  if (!(await canAccessShop(c.get('user'), existing.shopId))) {
    return c.json({ error: 'not_found' }, 404);
  }

  const deleted = await db
    .delete(customers)
    .where(eq(customers.id, id))
    .returning({ id: customers.id });

  if (deleted.length === 0) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ deleted: true, id });
}
