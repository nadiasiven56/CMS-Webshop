/**
 * Serializers — Drizzle-row → API-DTO voor de shops-module.
 *
 * Conventie (zie WAVE1-BACKEND-CONTRACT):
 *   - timestamps → ISO-string
 *   - numeric (price_override) blijft string (Money), nooit number
 *   - jsonb (branding / vat_config) shape stabiel houden
 */
import type { Shop } from '../../db/schema/shops.js';
import type { ShopProduct } from '../../db/schema/shop-products.js';

export interface ShopDto {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  locale: string;
  currency: string;
  status: string;
  branding: Record<string, unknown>;
  vatConfig: Record<string, unknown>;
  defaultLocationId: string | null;
  supportEmail: string | null;
  paymentProvider: string | null;
  hasPaymentKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toShopDto(s: Shop): ShopDto {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    domain: s.domain,
    locale: s.locale,
    currency: s.currency,
    status: s.status,
    branding: (s.branding ?? {}) as Record<string, unknown>,
    vatConfig: (s.vatConfig ?? {}) as Record<string, unknown>,
    defaultLocationId: s.defaultLocationId,
    supportEmail: s.supportEmail,
    paymentProvider: s.paymentProvider ?? null,
    hasPaymentKey: !!s.paymentCredentials,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * Per-shop product-publicatie. `priceOverride` blijft string|null (Money).
 * `productTitle`/`productSlug`/`productStatus` zijn optioneel — alleen gevuld
 * als de query met de products-tabel joint (GET /:id/products doet dat).
 */
export interface ShopProductDto {
  id: string;
  shopId: string;
  productId: string;
  published: boolean;
  priceOverride: string | null;
  position: number;
  publishedAt: string | null;
  product?: {
    id: string;
    slug: string;
    title: string;
    status: string;
  } | null;
}

export function toShopProductDto(
  sp: ShopProduct,
  product?: { id: string; slug: string; title: string; status: string } | null,
): ShopProductDto {
  const dto: ShopProductDto = {
    id: sp.id,
    shopId: sp.shopId,
    productId: sp.productId,
    published: sp.published,
    priceOverride: sp.priceOverride,
    position: sp.position,
    publishedAt: sp.publishedAt ? sp.publishedAt.toISOString() : null,
  };
  if (product !== undefined) dto.product = product;
  return dto;
}
