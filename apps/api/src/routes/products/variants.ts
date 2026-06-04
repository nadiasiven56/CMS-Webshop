/**
 * Variant-endpoints onder /api/products/:id/variants[/:variantId].
 *
 * - POST   /:id/variants                — add variant
 * - PATCH  /:id/variants/:variantId     — partial update
 * - DELETE /:id/variants/:variantId     — soft: active=false
 *
 * Audit: per write 1 row.
 */
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { products, variants } from '../../db/schema/index.js';
import {
  VariantCreateInputSchema,
  VariantUpdateInputSchema,
} from './_schemas.js';
import { writeProductAudit } from '../../domain/products/audit.js';
import { toVariantDto } from './_serialize.js';
import { isUuid } from './_validate.js';

export async function addVariant(c: Context): Promise<Response> {
  const productId = c.req.param('id');
  if (!isUuid(productId)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const body = await c.req.json().catch(() => null);
  const parsed = VariantCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const inserted = await db.transaction(async (tx) => {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!product) return null;

    const [row] = await tx
      .insert(variants)
      .values({
        productId,
        sku: input.sku,
        price: input.price,
        compareAtPrice: input.compareAtPrice ?? null,
        costPrice: input.costPrice ?? null,
        weightG: input.weightG ?? null,
        lengthMm: input.lengthMm ?? null,
        widthMm: input.widthMm ?? null,
        heightMm: input.heightMm ?? null,
        barcode: input.barcode ?? null,
        selectedOptions: input.selectedOptions ?? {},
        position: input.position ?? 0,
        taxable: input.taxable ?? true,
        taxClass: input.taxClass ?? 'standard',
      })
      .returning();
    if (!row) throw new Error('addVariant: insert returned no row');

    await writeProductAudit(tx, {
      action: 'create',
      entityType: 'variant',
      entityId: row.id,
      actorId: user.id,
      after: { id: row.id, sku: row.sku, price: row.price, productId },
      ip,
    });

    return row;
  });

  if (!inserted) {
    return c.json({ error: 'not_found', message: 'product not found' }, 404);
  }
  return c.json({ variant: toVariantDto(inserted) }, 201);
}

export async function updateVariantHandler(c: Context): Promise<Response> {
  const productId = c.req.param('id');
  const variantId = c.req.param('variantId');
  if (!isUuid(productId) || !isUuid(variantId)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const body = await c.req.json().catch(() => null);
  const parsed = VariantUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(variants)
      .where(and(eq(variants.id, variantId), eq(variants.productId, productId)))
      .limit(1);
    if (!existing) return null;

    const patch: Partial<typeof variants.$inferInsert> = {};
    if (input.sku !== undefined) patch.sku = input.sku;
    if (input.price !== undefined) patch.price = input.price;
    if (input.compareAtPrice !== undefined) patch.compareAtPrice = input.compareAtPrice;
    if (input.costPrice !== undefined) patch.costPrice = input.costPrice;
    if (input.weightG !== undefined) patch.weightG = input.weightG;
    if (input.lengthMm !== undefined) patch.lengthMm = input.lengthMm;
    if (input.widthMm !== undefined) patch.widthMm = input.widthMm;
    if (input.heightMm !== undefined) patch.heightMm = input.heightMm;
    if (input.barcode !== undefined) patch.barcode = input.barcode;
    if (input.selectedOptions !== undefined) patch.selectedOptions = input.selectedOptions;
    if (input.position !== undefined) patch.position = input.position;
    if (input.taxable !== undefined) patch.taxable = input.taxable;
    if (input.taxClass !== undefined) patch.taxClass = input.taxClass;
    if (input.active !== undefined) patch.active = input.active;
    patch.updatedAt = new Date();

    await tx.update(variants).set(patch).where(eq(variants.id, variantId));

    const [after] = await tx
      .select()
      .from(variants)
      .where(eq(variants.id, variantId))
      .limit(1);
    if (!after) throw new Error('updateVariant: row vanished after update');

    await writeProductAudit(tx, {
      action: 'update',
      entityType: 'variant',
      entityId: variantId,
      actorId: user.id,
      before: { sku: existing.sku, price: existing.price, active: existing.active },
      after: { sku: after.sku, price: after.price, active: after.active },
      ip,
    });

    return after;
  });

  if (!result) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ variant: toVariantDto(result) });
}

export async function deleteVariantHandler(c: Context): Promise<Response> {
  const productId = c.req.param('id');
  const variantId = c.req.param('variantId');
  if (!isUuid(productId) || !isUuid(variantId)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(variants)
      .where(and(eq(variants.id, variantId), eq(variants.productId, productId)))
      .limit(1);
    if (!existing) return null;
    if (!existing.active) return existing; // idempotent

    await tx
      .update(variants)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(variants.id, variantId));

    await writeProductAudit(tx, {
      action: 'delete',
      entityType: 'variant',
      entityId: variantId,
      actorId: user.id,
      before: { active: true },
      after: { active: false },
      ip,
    });

    return { ...existing, active: false };
  });

  if (!result) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ variant: { id: result.id, active: false } });
}
