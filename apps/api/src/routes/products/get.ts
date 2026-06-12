/**
 * GET /api/products/:id — full product met varianten + options + images.
 *
 * 200 { product: ProductWithRelations }
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
import {
  toProductCore,
  toVariantDto,
  toProductOptionDto,
  toProductImageDto,
} from './_serialize.js';
import { isUuid } from './_validate.js';
import { canAccessProduct } from '../../lib/access.js';

export async function getProduct(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const user = c.get('user');

  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  // Multi-user: andermans product gedraagt zich als onbestaand (404, geen 403)
  // zodat product-ids niet enumerable zijn.
  if (!product || !canAccessProduct(user, product)) {
    return c.json({ error: 'not_found' }, 404);
  }

  const [variantRows, optionRows, imageRows] = await Promise.all([
    db
      .select()
      .from(variants)
      .where(eq(variants.productId, product.id))
      .orderBy(asc(variants.position), asc(variants.createdAt)),
    db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, product.id))
      .orderBy(asc(productOptions.position)),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product.id))
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
      ...toProductCore(product),
      variants: variantRows.map(toVariantDto),
      options: optionRows.map((o) => toProductOptionDto(o, valueRows)),
      images: imageRows.map(toProductImageDto),
    },
  });
}
