/**
 * GET /api/customers/:id — klant-detail incl. adressen.
 *
 * 200 { customer: CustomerDto, addresses: CustomerAddressDto[] }
 * 400 invalid_id
 * 404 not_found
 */
import type { Context } from 'hono';
import { eq, asc } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { customers, customerAddresses } from '../../db/schema/index.js';
import { canAccessShop } from '../../lib/access.js';
import { toCustomerDto, toCustomerAddressDto } from './_serialize.js';
import { isUuid } from './_validate.js';

export async function getCustomer(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!customer) {
    return c.json({ error: 'not_found' }, 404);
  }
  // Multi-user: shop niet toegankelijk → zelfde 404 (geen existence-leak).
  if (!(await canAccessShop(c.get('user'), customer.shopId))) {
    return c.json({ error: 'not_found' }, 404);
  }

  const addressRows = await db
    .select()
    .from(customerAddresses)
    .where(eq(customerAddresses.customerId, id))
    .orderBy(asc(customerAddresses.createdAt));

  return c.json({
    customer: toCustomerDto(customer),
    addresses: addressRows.map(toCustomerAddressDto),
  });
}
