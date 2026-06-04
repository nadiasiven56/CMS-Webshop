/**
 * Storefront catalogus.
 *
 *   GET /products          — gepubliceerde shop_products van de shop, met
 *                            price_override toegepast. paginate + filter.
 *   GET /products/:slug    — detail met variants + images + voorraad.
 *
 * "Gepubliceerd" = shop_products.published = true. Het onderliggende product
 * hoeft geen status-check (admin-status is intern); publicatie in de shop is
 * leidend. We tonen wel alleen `active` variants.
 */
import type { Context } from 'hono';
import { and, asc, desc, eq, ilike, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import {
  products,
  shopProducts,
  variants,
  productImages,
  type Shop,
} from '../../db/schema/index.js';
import {
  effectivePrice,
  availableByVariant,
} from './_pricing.js';
import {
  toStorefrontVariant,
  toStorefrontImage,
  type StorefrontProductListItemDto,
  type StorefrontProductDetailDto,
} from './_serialize.js';

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(24),
  offset: z.coerce.number().int().min(0).optional().default(0),
  search: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
  sort: z
    .enum(['position', 'newest', 'price_asc', 'price_desc', 'title'])
    .optional()
    .default('position'),
});

export async function listCatalog(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const parsed = ListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset, search, tag, sort } = parsed.data;

  // shop_products (published) JOIN products
  const conditions = [
    eq(shopProducts.shopId, shop.id),
    eq(shopProducts.published, true),
  ];
  if (search) conditions.push(ilike(products.title, `%${search}%`));
  const whereExpr = and(...conditions);

  const orderBy = (() => {
    switch (sort) {
      case 'newest':
        return [desc(shopProducts.publishedAt), desc(products.createdAt)];
      case 'title':
        return [asc(products.title)];
      case 'position':
      default:
        return [asc(shopProducts.position), asc(products.title)];
    }
  })();

  const rows = await db
    .select({
      productId: products.id,
      slug: products.slug,
      title: products.title,
      vendor: products.vendor,
      productType: products.productType,
      tags: products.tags,
      createdAt: products.createdAt,
      priceOverride: shopProducts.priceOverride,
      position: shopProducts.position,
      publishedAt: shopProducts.publishedAt,
    })
    .from(shopProducts)
    .innerJoin(products, eq(products.id, shopProducts.productId))
    .where(whereExpr)
    .orderBy(...orderBy);

  // tag-filter (text[] — eenvoudig in JS, klein V1-volume)
  let filtered = rows;
  if (tag) {
    filtered = rows.filter((r) => (r.tags ?? []).includes(tag));
  }

  const total = filtered.length;
  const pageRows = filtered.slice(offset, offset + limit);
  const productIds = pageRows.map((r) => r.productId);

  // variants (active) voor prijs-bepaling + primary image
  const variantRows =
    productIds.length > 0
      ? await db
          .select()
          .from(variants)
          .where(
            and(inArray(variants.productId, productIds), eq(variants.active, true)),
          )
          .orderBy(asc(variants.position))
      : [];

  const variantsByProduct = new Map<string, typeof variantRows>();
  for (const v of variantRows) {
    const arr = variantsByProduct.get(v.productId) ?? [];
    arr.push(v);
    variantsByProduct.set(v.productId, arr);
  }

  const imageRows =
    productIds.length > 0
      ? await db
          .select()
          .from(productImages)
          .where(inArray(productImages.productId, productIds))
          .orderBy(asc(productImages.position))
      : [];
  const primaryImageByProduct = new Map<string, string>();
  for (const img of imageRows) {
    if (!primaryImageByProduct.has(img.productId)) {
      primaryImageByProduct.set(img.productId, img.url);
    }
  }

  let items: StorefrontProductListItemDto[] = pageRows.map((r) => {
    const vs = variantsByProduct.get(r.productId) ?? [];
    // laagste effectieve prijs als "vanaf"-prijs
    let minPrice: string | null = null;
    let compareAt: string | null = null;
    for (const v of vs) {
      const p = effectivePrice(v, r.priceOverride);
      if (minPrice == null || Number(p) < Number(minPrice)) {
        minPrice = p;
        compareAt = v.compareAtPrice;
      }
    }
    return {
      id: r.productId,
      slug: r.slug,
      title: r.title,
      vendor: r.vendor,
      productType: r.productType,
      tags: r.tags ?? [],
      price: minPrice,
      compareAtPrice: compareAt,
      primaryImageUrl: primaryImageByProduct.get(r.productId) ?? null,
      position: r.position,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    };
  });

  // price-sort (na effectieve-prijs-berekening)
  if (sort === 'price_asc') {
    items = items.sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0));
  } else if (sort === 'price_desc') {
    items = items.sort((a, b) => Number(b.price ?? 0) - Number(a.price ?? 0));
  }

  return c.json({ items, total, limit, offset });
}

export async function getCatalogProduct(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const slug = c.req.param('slug');
  if (!slug) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const [row] = await db
    .select({
      productId: products.id,
      slug: products.slug,
      title: products.title,
      descriptionHtml: products.descriptionHtml,
      vendor: products.vendor,
      productType: products.productType,
      tags: products.tags,
      priceOverride: shopProducts.priceOverride,
      position: shopProducts.position,
      publishedAt: shopProducts.publishedAt,
    })
    .from(shopProducts)
    .innerJoin(products, eq(products.id, shopProducts.productId))
    .where(
      and(
        eq(shopProducts.shopId, shop.id),
        eq(shopProducts.published, true),
        eq(products.slug, slug),
      ),
    )
    .limit(1);

  if (!row) {
    return c.json({ error: 'product_not_found' }, 404);
  }

  const variantRows = await db
    .select()
    .from(variants)
    .where(and(eq(variants.productId, row.productId), eq(variants.active, true)))
    .orderBy(asc(variants.position));

  const availMap = await availableByVariant(variantRows.map((v) => v.id));

  const imageRows = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, row.productId))
    .orderBy(asc(productImages.position));

  let minPrice: string | null = null;
  let compareAt: string | null = null;
  const variantDtos = variantRows.map((v) => {
    const p = effectivePrice(v, row.priceOverride);
    if (minPrice == null || Number(p) < Number(minPrice)) {
      minPrice = p;
      compareAt = v.compareAtPrice;
    }
    return toStorefrontVariant(v, p, availMap.get(v.id) ?? 0);
  });

  const detail: StorefrontProductDetailDto = {
    id: row.productId,
    slug: row.slug,
    title: row.title,
    descriptionHtml: row.descriptionHtml,
    vendor: row.vendor,
    productType: row.productType,
    tags: row.tags ?? [],
    price: minPrice,
    compareAtPrice: compareAt,
    position: row.position,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    variants: variantDtos,
    images: imageRows.map(toStorefrontImage),
  };

  return c.json({ product: detail });
}
