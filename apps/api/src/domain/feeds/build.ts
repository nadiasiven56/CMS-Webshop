/**
 * Feed-builder — laadt GEPUBLICEERDE producten/varianten van een shop en
 * normaliseert ze naar {@link FeedItem}[].
 *
 * KRITISCH: dit hergebruikt EXACT dezelfde bron als de publieke storefront-
 * catalogus (`routes/storefront/catalog.ts` + `_pricing.ts`), zodat de feed
 * 1-op-1 matcht met wat een bezoeker op de winkel ziet:
 *   - "gepubliceerd" = `shop_products.published = true` (admin-status is intern)
 *   - alleen `variants.active = true`
 *   - effectieve prijs = `effectivePrice(variant, shop_products.price_override)`
 *   - voorraad via `availableByVariant` (storefront-helper) → availability
 *   - primary image = laagste-position `product_images.url`
 *
 * Granulariteit: de storefront toont 1 kaart per product (vanaf-prijs). Voor
 * een product-feed wil Google/Meta echter 1 regel per koopbare SKU/variant —
 * daarom emitten we 1 {@link FeedItem} per actieve variant, met de variant-SKU
 * als feed-id. De prijs per variant gebruikt dezelfde override-regel.
 *
 * NEVER-THROW: deze module gooit niet op een lege shop of ontbrekende data —
 * een lege `FeedItem[]` is een geldig resultaat (build.ts → valide lege feed).
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { env } from '../../lib/env.js';
import {
  products,
  shopProducts,
  variants,
  productImages,
  shops,
  type Shop,
} from '../../db/schema/index.js';
// Hergebruik de storefront-pricing/voorraad-helpers — zelfde bron als de winkel.
import {
  effectivePrice,
  availableByVariant,
} from '../../routes/storefront/_pricing.js';
import { renderGoogleShoppingXml } from './google.js';
import { renderMetaCsv } from './meta.js';
import type {
  BuildFeedOpts,
  FeedItem,
  FeedShop,
  RenderedFeed,
} from './types.js';

/**
 * Publieke basis-URL voor link/imageLink. We lezen `PUBLIC_BASE_URL` los uit
 * `process.env` (env.ts mag niet aangeraakt worden) en vallen terug op
 * `API_PUBLIC_URL` — zelfde patroon als lib/storage. Trailing slash gestript.
 */
export function publicBaseUrl(): string {
  const raw = process.env.PUBLIC_BASE_URL ?? env.API_PUBLIC_URL;
  return raw.replace(/\/+$/, '');
}

/** Maak van een `shops`-row de minimale {@link FeedShop}. */
export function toFeedShop(shop: Shop): FeedShop {
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    domain: shop.domain,
    currency: shop.currency,
  };
}

/** Strip HTML-tags + collapse whitespace → plain-text omschrijving. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Storefront-product-detail-link voor een product-slug. Volgt de storefront-
 * conventie `/products/:slug` (zie storefront/catalog.ts). De feed wijst naar
 * het custom-domein als de shop dat heeft, anders naar de slug-scoped API-base.
 */
export function productLink(shop: FeedShop, slug: string, baseUrl: string): string {
  if (shop.domain) {
    return `https://${shop.domain}/products/${slug}`;
  }
  // Fallback: storefront API met shop-scope via ?shop=<slug>. Operator kan dit
  // via feed_config later op het echte storefront-domein zetten.
  return `${baseUrl}/api/storefront/v1/products/${encodeURIComponent(slug)}?shop=${encodeURIComponent(shop.slug)}`;
}

/** Maak een image-link absoluut (storefront kan relatieve /storage-paden geven). */
export function absoluteImageLink(url: string | null, baseUrl: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Laad genormaliseerde feed-items voor een shop. Hergebruikt de storefront-
 * catalogus-query (published shop_products → products → active variants →
 * images) + de storefront pricing/voorraad-helpers.
 *
 * Never-throw op lege data: geeft `[]` terug.
 */
export async function buildFeedItems(
  shopId: string,
  opts: BuildFeedOpts = {},
): Promise<FeedItem[]> {
  const [shopRow] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shopRow) return [];
  const shop = toFeedShop(shopRow);

  const baseUrl = opts.baseUrl ?? publicBaseUrl();
  const currency = opts.currency ?? shop.currency ?? 'EUR';
  const includeOutOfStock = opts.includeOutOfStock ?? false;

  // 1) published shop_products JOIN products — zelfde where als storefront.
  const rows = await db
    .select({
      productId: products.id,
      slug: products.slug,
      title: products.title,
      descriptionHtml: products.descriptionHtml,
      vendor: products.vendor,
      productType: products.productType,
      priceOverride: shopProducts.priceOverride,
      position: shopProducts.position,
    })
    .from(shopProducts)
    .innerJoin(products, eq(products.id, shopProducts.productId))
    .where(and(eq(shopProducts.shopId, shopId), eq(shopProducts.published, true)))
    .orderBy(asc(shopProducts.position), asc(products.title));

  if (rows.length === 0) return [];

  const productIds = rows.map((r) => r.productId);

  // 2) active variants voor deze producten (zelfde filter als storefront).
  const variantRows = await db
    .select()
    .from(variants)
    .where(and(inArray(variants.productId, productIds), eq(variants.active, true)))
    .orderBy(asc(variants.position));

  // 3) primary image per product (laagste position).
  const imageRows = await db
    .select()
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(asc(productImages.position));
  const primaryImageByProduct = new Map<string, string>();
  for (const img of imageRows) {
    if (!primaryImageByProduct.has(img.productId)) {
      primaryImageByProduct.set(img.productId, img.url);
    }
  }

  // 4) voorraad per variant via storefront-helper (zelfde availability-bron).
  const availMap = await availableByVariant(variantRows.map((v) => v.id));

  const rowByProduct = new Map(rows.map((r) => [r.productId, r]));

  const items: FeedItem[] = [];
  for (const v of variantRows) {
    const p = rowByProduct.get(v.productId);
    if (!p) continue;

    const available = availMap.get(v.id) ?? 0;
    const inStock = available > 0;
    if (!inStock && !includeOutOfStock) continue;

    const price = effectivePrice(v, p.priceOverride);
    const link = productLink(shop, p.slug, baseUrl);
    const imageLink = absoluteImageLink(
      primaryImageByProduct.get(p.productId) ?? null,
      baseUrl,
    );

    const item: FeedItem = {
      id: v.sku || v.id,
      sku: v.sku || v.id,
      title: p.title,
      description: htmlToText(p.descriptionHtml) || p.title,
      link,
      imageLink,
      price,
      currency,
      availability: inStock ? 'in_stock' : 'out_of_stock',
      condition: 'new',
      brand: p.vendor ?? '',
      productType: p.productType ?? '',
    };
    if (v.barcode) item.gtin = v.barcode;
    items.push(item);
  }

  return items;
}

/**
 * Bouw + render een complete feed voor een channel. Laadt de items, kiest de
 * juiste renderer en geeft `{ contentType, body, itemCount }` terug.
 *
 * NEVER-THROW op lege shop/feed: de renderers produceren een geldige LEGE feed
 * (RSS met 0 items / CSV-header zonder rijen).
 */
export async function buildFeed(
  shop: Shop,
  channel: 'google_shopping' | 'meta',
  opts: BuildFeedOpts = {},
): Promise<RenderedFeed> {
  const feedShop = toFeedShop(shop);
  const items = await buildFeedItems(shop.id, opts);

  if (channel === 'meta') {
    const body = renderMetaCsv(feedShop, items);
    return { contentType: 'text/csv; charset=utf-8', body, itemCount: items.length };
  }
  // default google_shopping
  const body = renderGoogleShoppingXml(feedShop, items);
  return {
    contentType: 'application/xml; charset=utf-8',
    body,
    itemCount: items.length,
  };
}
