/**
 * PATCH /api/products/:id — partial update.
 *
 * Body: ProductUpdateInput (zie shared/api/products.ts)
 * - slug-rename? regenereer uniqueness.
 * - alleen non-undefined velden updaten.
 *
 * Audit: 'update' met before/after diff.
 *
 * 200 { product: ProductWithRelations } (full re-fetch)
 * 400 invalid_request
 * 404 not_found
 */
import type { Context } from 'hono';
import { eq, asc, inArray } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import {
  products,
  variants,
  productOptions,
  productOptionValues,
  productImages,
} from '../../db/schema/index.js';
import { ProductUpdateInputSchema } from './_schemas.js';
import { slugify } from '../../domain/products/slugify.js';
import { makeUniqueSlug } from '../../domain/products/slug-unique.js';
import { writeProductAudit } from '../../domain/products/audit.js';
import {
  toProductCore,
  toVariantDto,
  toProductOptionDto,
  toProductImageDto,
} from './_serialize.js';
import { isUuid } from './_validate.js';
import { canAccessProduct } from '../../lib/access.js';

export async function updateProduct(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ProductUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(products).where(eq(products.id, id)).limit(1);
    // Multi-user: andermans product = 404 (zelfde shape als onbestaand).
    if (!existing || !canAccessProduct(user, existing)) return null;

    const patch: Partial<typeof products.$inferInsert> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.descriptionHtml !== undefined) patch.descriptionHtml = input.descriptionHtml;
    if (input.vendor !== undefined) patch.vendor = input.vendor;
    if (input.productType !== undefined) patch.productType = input.productType;
    if (input.status !== undefined) patch.status = input.status;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.publishedAt !== undefined) {
      patch.publishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
    }

    // Slug-handling: explicit override of auto-regenerate bij title-change?
    // V1 keuze: slug verandert ALLEEN als de client expliciet `slug` stuurt;
    // anders blijft hij stabiel (SEO-vriendelijk).
    if (input.slug !== undefined) {
      const baseSlug = slugify(input.slug);
      const finalSlug = await makeUniqueSlug(tx, baseSlug, { excludeId: id });
      patch.slug = finalSlug;
    }

    patch.updatedAt = new Date();

    if (Object.keys(patch).length > 0) {
      await tx.update(products).set(patch).where(eq(products.id, id));
    }

    const [after] = await tx.select().from(products).where(eq(products.id, id)).limit(1);
    if (!after) throw new Error('updateProduct: row vanished after update');

    await writeProductAudit(tx, {
      action: 'update',
      entityType: 'product',
      entityId: id,
      actorId: user.id,
      before: {
        title: existing.title,
        slug: existing.slug,
        status: existing.status,
        tags: existing.tags,
      },
      after: {
        title: after.title,
        slug: after.slug,
        status: after.status,
        tags: after.tags,
      },
      ip,
    });

    return after;
  });

  if (!updated) {
    return c.json({ error: 'not_found' }, 404);
  }

  // Full re-fetch zodat client geen extra GET hoeft te doen
  const [variantRows, optionRows, imageRows] = await Promise.all([
    db
      .select()
      .from(variants)
      .where(eq(variants.productId, id))
      .orderBy(asc(variants.position), asc(variants.createdAt)),
    db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, id))
      .orderBy(asc(productOptions.position)),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.position), asc(productImages.createdAt)),
  ]);
  const optionIds = optionRows.map((o) => o.id);
  const valueRows =
    optionIds.length > 0
      ? await db
          .select()
          .from(productOptionValues)
          .where(inArray(productOptionValues.optionId, optionIds))
          .orderBy(asc(productOptionValues.position))
      : [];

  return c.json({
    product: {
      ...toProductCore(updated),
      variants: variantRows.map(toVariantDto),
      options: optionRows.map((o) => toProductOptionDto(o, valueRows)),
      images: imageRows.map(toProductImageDto),
    },
  });
}
