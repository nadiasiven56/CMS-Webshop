/**
 * PATCH /api/customers/:id — partial update.
 *
 * Body: CustomerUpdateSchema (≥1 veld). shop_id verandert NIET (klant blijft
 * bij z'n shop). email-rename respecteert UNIQUE(shop_id, email) → 409.
 *
 * 200 { customer: CustomerDto }
 * 400 invalid_request / invalid_id
 * 404 not_found
 * 409 email_taken
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { customers } from '../../db/schema/index.js';
import { canAccessShop } from '../../lib/access.js';
import { CustomerUpdateSchema } from './_schemas.js';
import { toCustomerDto } from './_serialize.js';
import { isUuid } from './_validate.js';
import { isUniqueViolation } from './_db-errors.js';

export async function updateCustomer(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = CustomerUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const [existing] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!existing) {
    return c.json({ error: 'not_found' }, 404);
  }
  // Multi-user: shop niet toegankelijk → zelfde 404 (geen existence-leak).
  if (!(await canAccessShop(c.get('user'), existing.shopId))) {
    return c.json({ error: 'not_found' }, 404);
  }

  const patch: Partial<typeof customers.$inferInsert> = {};
  if (input.email !== undefined) patch.email = input.email;
  if (input.firstName !== undefined) patch.firstName = input.firstName ?? null;
  if (input.lastName !== undefined) patch.lastName = input.lastName ?? null;
  if (input.phone !== undefined) patch.phone = input.phone ?? null;
  if (input.company !== undefined) patch.company = input.company ?? null;
  if (input.vatNumber !== undefined) patch.vatNumber = input.vatNumber ?? null;
  if (input.acceptsMarketing !== undefined) patch.acceptsMarketing = input.acceptsMarketing;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.notes !== undefined) patch.notes = input.notes ?? null;
  patch.updatedAt = new Date();

  try {
    const [updated] = await db
      .update(customers)
      .set(patch)
      .where(eq(customers.id, id))
      .returning();
    if (!updated) {
      // Race: row verdween tussen select en update.
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({ customer: toCustomerDto(updated) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: 'email_taken' }, 409);
    }
    throw err;
  }
}
