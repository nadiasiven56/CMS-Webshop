/**
 * Lokale types voor de shops-admin-UI.
 *
 * Spiegelt de backend-DTO's uit `apps/api/src/routes/shops/_serialize.ts`
 * (toShopDto / toShopProductDto) + de Zod-input-schemas (_schemas.ts).
 * Geld (`priceOverride`) blijft ALTIJD een string (Money-conventie), nooit number.
 */

export interface ShopBranding {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  font?: string;
  theme?: string;
  [k: string]: unknown;
}

export interface ShopVatConfig {
  priceIncludesVat?: boolean;
  defaultCountry?: string;
  oss?: boolean;
  [k: string]: unknown;
}

export type ShopStatus = 'active' | 'draft' | 'paused';

/** Volledige shop-DTO zoals `GET /api/shops/:id` levert. */
export interface ShopDto {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  locale: string;
  currency: string;
  status: string;
  branding: ShopBranding;
  vatConfig: ShopVatConfig;
  defaultLocationId: string | null;
  supportEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShopListResponse {
  items: ShopDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Body voor POST /api/shops. */
export interface ShopCreateInput {
  slug: string;
  name: string;
  domain?: string | null;
  locale?: string;
  currency?: string;
  status?: ShopStatus;
  branding?: ShopBranding;
  vatConfig?: ShopVatConfig;
  supportEmail?: string | null;
}

/** Body voor PATCH /api/shops/:id (alle velden optioneel). */
export type ShopUpdateInput = Partial<ShopCreateInput>;

/** Product-publicatie-rij (`GET /api/shops/:id/products`). */
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

export interface ShopProductsResponse {
  shopId: string;
  items: ShopProductDto[];
  total: number;
}

/** Body voor PUT /api/shops/:id/products/:productId. */
export interface ShopProductUpsertInput {
  published?: boolean;
  priceOverride?: string | null;
  position?: number;
}

/** Slank catalogus-item (uit `GET /api/products`) voor de publicatie-matrix. */
export interface CatalogProduct {
  id: string;
  slug: string;
  title: string;
  status: string;
}
