/**
 * Geneste adres-routes onder /api/customers/:id/addresses.
 *
 *   GET    /:id/addresses              — lijst (gesorteerd op created_at)
 *   POST   /:id/addresses              — create (billing|shipping, is_default)
 *   PATCH  /:id/addresses/:addressId   — partial update
 *   DELETE /:id/addresses/:addressId   — delete
 *
 * Default-regel: per (customer, type) is er max één is_default=true. Bij het
 * zetten van is_default unset'en we de andere defaults van datzelfde type
 * binnen één transactie.
 */
import type { Context } from 'hono';
import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { customers, customerAddresses } from '../../db/schema/index.js';
import { AddressCreateSchema, AddressUpdateSchema } from './_schemas.js';
import { toCustomerAddressDto } from './_serialize.js';
import { isUuid } from './_validate.js';

/** Bestaat de klant? (alle adres-routes zijn genest onder een klant) */
async function customerExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  return Boolean(row);
}

export async function listAddresses(c: Context): Promise<Response> {
  const customerId = c.req.param('id');
  if (!isUuid(customerId)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  if (!(await customerExists(customerId))) {
    return c.json({ error: 'not_found' }, 404);
  }

  const rows = await db
    .select()
    .from(customerAddresses)
    .where(eq(customerAddresses.customerId, customerId))
    .orderBy(asc(customerAddresses.createdAt));

  return c.json({ addresses: rows.map(toCustomerAddressDto) });
}

export async function createAddress(c: Context): Promise<Response> {
  const customerId = c.req.param('id');
  if (!isUuid(customerId)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = AddressCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const address = await db.transaction(async (tx) => {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (!customer) return null;

    const isDefault = input.isDefault ?? false;
    if (isDefault) {
      // Unset andere defaults van hetzelfde type voor deze klant.
      await tx
        .update(customerAddresses)
        .set({ isDefault: false })
        .where(
          and(
            eq(customerAddresses.customerId, customerId),
            eq(customerAddresses.type, input.type),
            eq(customerAddresses.isDefault, true),
          ),
        );
    }

    const [row] = await tx
      .insert(customerAddresses)
      .values({
        customerId,
        type: input.type,
        isDefault,
        name: input.name ?? null,
        line1: input.line1 ?? null,
        line2: input.line2 ?? null,
        postcode: input.postcode ?? null,
        city: input.city ?? null,
        province: input.province ?? null,
        country: input.country ?? null,
        phone: input.phone ?? null,
      })
      .returning();
    if (!row) throw new Error('address insert returned no row');
    return row;
  });

  if (!address) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ address: toCustomerAddressDto(address) }, 201);
}

export async function updateAddress(c: Context): Promise<Response> {
  const customerId = c.req.param('id');
  const addressId = c.req.param('addressId');
  if (!isUuid(customerId) || !isUuid(addressId)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = AddressUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.id, addressId),
          eq(customerAddresses.customerId, customerId),
        ),
      )
      .limit(1);
    if (!existing) return null;

    const patch: Partial<typeof customerAddresses.$inferInsert> = {};
    if (input.type !== undefined) patch.type = input.type;
    if (input.isDefault !== undefined) patch.isDefault = input.isDefault;
    if (input.name !== undefined) patch.name = input.name ?? null;
    if (input.line1 !== undefined) patch.line1 = input.line1 ?? null;
    if (input.line2 !== undefined) patch.line2 = input.line2 ?? null;
    if (input.postcode !== undefined) patch.postcode = input.postcode ?? null;
    if (input.city !== undefined) patch.city = input.city ?? null;
    if (input.province !== undefined) patch.province = input.province ?? null;
    if (input.country !== undefined) patch.country = input.country ?? null;
    if (input.phone !== undefined) patch.phone = input.phone ?? null;

    // Effectief type + default na patch (voor de unset-stap).
    const effectiveType = input.type ?? existing.type;
    const willBeDefault = input.isDefault ?? existing.isDefault;
    if (willBeDefault) {
      await tx
        .update(customerAddresses)
        .set({ isDefault: false })
        .where(
          and(
            eq(customerAddresses.customerId, customerId),
            eq(customerAddresses.type, effectiveType),
            eq(customerAddresses.isDefault, true),
            ne(customerAddresses.id, addressId),
          ),
        );
    }

    const [row] = await tx
      .update(customerAddresses)
      .set(patch)
      .where(eq(customerAddresses.id, addressId))
      .returning();
    return row ?? null;
  });

  if (!updated) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ address: toCustomerAddressDto(updated) });
}

export async function deleteAddress(c: Context): Promise<Response> {
  const customerId = c.req.param('id');
  const addressId = c.req.param('addressId');
  if (!isUuid(customerId) || !isUuid(addressId)) {
    return c.json({ error: 'invalid_id' }, 400);
  }

  const deleted = await db
    .delete(customerAddresses)
    .where(
      and(
        eq(customerAddresses.id, addressId),
        eq(customerAddresses.customerId, customerId),
      ),
    )
    .returning({ id: customerAddresses.id });

  if (deleted.length === 0) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ deleted: true, id: addressId });
}
