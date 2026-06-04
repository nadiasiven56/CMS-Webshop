/**
 * POST /api/customers — create klant (shop-scoped).
 *
 * Body: CustomerCreateSchema (shopId + email verplicht, B2B-velden optioneel).
 * UNIQUE(shop_id, email) → 409 email_taken bij duplicaat.
 *
 * 201 { customer: CustomerDto }
 * 400 invalid_request
 * 404 shop_not_found
 * 409 email_taken
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { customers, shops } from '../../db/schema/index.js';
import { CustomerCreateSchema } from './_schemas.js';
import { toCustomerDto } from './_serialize.js';
import { isUniqueViolation } from './_db-errors.js';

export async function createCustomer(c: Context): Promise<Response> {
  const body = await c.req.json().catch(() => null);
  const parsed = CustomerCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  // Shop bestaan-check (FK is cascade maar geeft generieke 23503 — nettere 404 hier).
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  if (!shop) {
    return c.json({ error: 'shop_not_found' }, 404);
  }

  try {
    const [customer] = await db
      .insert(customers)
      .values({
        shopId: input.shopId,
        email: input.email,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        phone: input.phone ?? null,
        company: input.company ?? null,
        vatNumber: input.vatNumber ?? null,
        acceptsMarketing: input.acceptsMarketing ?? false,
        tags: input.tags ?? [],
        notes: input.notes ?? null,
      })
      .returning();
    if (!customer) throw new Error('customer insert returned no row');

    return c.json({ customer: toCustomerDto(customer) }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: 'email_taken' }, 409);
    }
    throw err;
  }
}
