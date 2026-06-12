/**
 * GET /api/products — paginate + filter.
 *
 * Query:
 *   limit  number (1..100, default 20)
 *   offset number (>=0, default 0)
 *   status 'draft'|'active'|'archived' (optioneel)
 *   search string (case-insensitive ilike op title)
 *
 * Order: updated_at desc.
 *
 * Multi-user: role 'user' ziet alleen eigen producten (owner_user_id);
 * admin ziet alles (incl. platform-catalogus met owner_user_id = null).
 *
 * Response:
 *   { items: ProductListItem[], total: number, limit: number, offset: number }
 */
import type { Context } from 'hono';
import { and, desc, eq, ilike, inArray, count } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import {
  products,
  variants,
  productImages,
} from '../../db/schema/index.js';
import { ProductStatusSchema } from './_schemas.js';
import { toProductCore } from './_serialize.js';
import { isAdmin } from '../../lib/access.js';

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: ProductStatusSchema.optional(),
  search: z.string().trim().min(1).optional(),
});

export async function listProducts(c: Context): Promise<Response> {
  const user = c.get('user');
  const parsed = QuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset, status, search } = parsed.data;

  const conditions = [];
  // Multi-user scoping: non-admins zien alleen hun eigen producten.
  if (!isAdmin(user)) conditions.push(eq(products.ownerUserId, user.id));
  if (status) conditions.push(eq(products.status, status));
  if (search) conditions.push(ilike(products.title, `%${search}%`));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(products)
    .orderBy(desc(products.updatedAt))
    .limit(limit)
    .offset(offset);
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  // total
  const totalQuery = db.select({ c: count() }).from(products);
  const totalRes = whereExpr
    ? await totalQuery.where(whereExpr)
    : await totalQuery;
  const total = Number(totalRes[0]?.c ?? 0);

  // variant-counts + primary-image-url voor de zichtbare set
  const productIds = rows.map((r) => r.id);
  let variantCountByProduct = new Map<string, number>();
  let primaryImageByProduct = new Map<string, string>();

  if (productIds.length > 0) {
    const variantCounts = await db
      .select({
        productId: variants.productId,
        c: count(),
      })
      .from(variants)
      .where(inArray(variants.productId, productIds))
      .groupBy(variants.productId);
    variantCountByProduct = new Map(
      variantCounts.map((r) => [r.productId, Number(r.c)]),
    );

    // primary image = laagste position per product
    const imageRows = await db
      .select({
        productId: productImages.productId,
        url: productImages.url,
        position: productImages.position,
      })
      .from(productImages)
      .where(inArray(productImages.productId, productIds))
      .orderBy(productImages.position);
    for (const row of imageRows) {
      if (!primaryImageByProduct.has(row.productId)) {
        primaryImageByProduct.set(row.productId, row.url);
      }
    }
  }

  const items = rows.map((p) => ({
    ...toProductCore(p),
    variantCount: variantCountByProduct.get(p.id) ?? 0,
    primaryImageUrl: primaryImageByProduct.get(p.id) ?? null,
  }));

  return c.json({ items, total, limit, offset });
}
