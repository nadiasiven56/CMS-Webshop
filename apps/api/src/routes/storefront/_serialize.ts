/**
 * Storefront serializers — Drizzle-row → publieke API-DTO.
 *
 * Conventies (zie WAVE1-BACKEND-CONTRACT.md):
 *   - timestamps → `.toISOString()`
 *   - geld (`numeric`) blijft string (postgres-js levert string)
 *   - shop-scoped: we lekken GEEN admin-velden (cost_price, interne notes, etc.)
 *
 * Dit is de PUBLIEKE shape — alleen wat een storefront nodig heeft.
 */
import type {
  Shop,
  Variant,
  ProductImage,
  CmsPage,
  CmsBlock,
  CmsMenu,
  CmsMenuItem,
  BlogPost,
  Cart,
} from '../../db/schema/index.js';

// ─── Shop (publiek subset) ───────────────────────────────────

export interface StorefrontShopDto {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  locale: string;
  currency: string;
  branding: Record<string, unknown>;
  supportEmail: string | null;
}

export function toStorefrontShop(s: Shop): StorefrontShopDto {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    domain: s.domain,
    locale: s.locale,
    currency: s.currency,
    branding: s.branding as Record<string, unknown>,
    supportEmail: s.supportEmail,
  };
}

// ─── Catalog ─────────────────────────────────────────────────

/**
 * Lijst-item. `price` is de effectieve verkoopprijs in de shop:
 *   price_override van shop_products als gezet, anders de laagste variant-prijs.
 */
export interface StorefrontProductListItemDto {
  id: string;
  slug: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  price: string | null;
  compareAtPrice: string | null;
  primaryImageUrl: string | null;
  position: number;
  publishedAt: string | null;
}

/** Variant zoals publiek getoond (geen cost_price, geen dimensies-detail). */
export interface StorefrontVariantDto {
  id: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  barcode: string | null;
  selectedOptions: Record<string, string>;
  position: number;
  available: number;
  inStock: boolean;
}

export function toStorefrontVariant(
  v: Variant,
  effectivePrice: string,
  available: number,
): StorefrontVariantDto {
  return {
    id: v.id,
    sku: v.sku,
    price: effectivePrice,
    compareAtPrice: v.compareAtPrice,
    barcode: v.barcode,
    selectedOptions: v.selectedOptions,
    position: v.position,
    available,
    inStock: available > 0,
  };
}

export interface StorefrontProductImageDto {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

export function toStorefrontImage(img: ProductImage): StorefrontProductImageDto {
  return {
    id: img.id,
    url: img.url,
    alt: img.alt,
    position: img.position,
  };
}

export interface StorefrontProductDetailDto {
  id: string;
  slug: string;
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  price: string | null;
  compareAtPrice: string | null;
  position: number;
  publishedAt: string | null;
  variants: StorefrontVariantDto[];
  images: StorefrontProductImageDto[];
}

// ─── CMS ─────────────────────────────────────────────────────

export interface StorefrontPageDto {
  slug: string;
  title: string;
  template: string;
  blocks: unknown[];
  seo: Record<string, unknown>;
  publishedAt: string | null;
}

export function toStorefrontPage(p: CmsPage): StorefrontPageDto {
  return {
    slug: p.slug,
    title: p.title,
    template: p.template,
    blocks: p.blocks,
    seo: p.seo as Record<string, unknown>,
    publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
  };
}

export interface StorefrontBlockDto {
  key: string;
  type: string;
  content: Record<string, unknown>;
}

export function toStorefrontBlock(b: CmsBlock): StorefrontBlockDto {
  return { key: b.key, type: b.type, content: b.content };
}

export interface StorefrontMenuItemDto {
  id: string;
  parentId: string | null;
  label: string;
  url: string;
  position: number;
  children: StorefrontMenuItemDto[];
}

export interface StorefrontMenuDto {
  id: string;
  location: string;
  name: string;
  items: StorefrontMenuItemDto[];
}

/** Bouw geneste menu-tree uit platte cms_menu_items. */
export function toStorefrontMenu(
  menu: CmsMenu,
  items: CmsMenuItem[],
): StorefrontMenuDto {
  const byId = new Map<string, StorefrontMenuItemDto>();
  for (const it of items) {
    byId.set(it.id, {
      id: it.id,
      parentId: it.parentId,
      label: it.label,
      url: it.url,
      position: it.position,
      children: [],
    });
  }
  const roots: StorefrontMenuItemDto[] = [];
  for (const it of items) {
    const node = byId.get(it.id)!;
    if (it.parentId && byId.has(it.parentId)) {
      byId.get(it.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (arr: StorefrontMenuItemDto[]): void => {
    arr.sort((a, b) => a.position - b.position);
    for (const n of arr) sortRec(n.children);
  };
  sortRec(roots);
  return { id: menu.id, location: menu.location, name: menu.name, items: roots };
}

export interface StorefrontBlogPostDto {
  slug: string;
  title: string;
  excerpt: string | null;
  bodyHtml: string | null;
  coverImage: string | null;
  author: string | null;
  tags: string[];
  seo: Record<string, unknown>;
  publishedAt: string | null;
}

export function toStorefrontBlogPost(
  b: BlogPost,
  includeBody: boolean,
): StorefrontBlogPostDto {
  return {
    slug: b.slug,
    title: b.title,
    excerpt: b.excerpt,
    bodyHtml: includeBody ? b.bodyHtml : null,
    coverImage: b.coverImage,
    author: b.author,
    tags: b.tags,
    seo: b.seo as Record<string, unknown>,
    publishedAt: b.publishedAt ? b.publishedAt.toISOString() : null,
  };
}

// ─── Cart ────────────────────────────────────────────────────

export interface StorefrontCartLineDto {
  id: string;
  variantId: string;
  sku: string | null;
  title: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  available: number;
  imageUrl: string | null;
}

export interface StorefrontCartDto {
  token: string;
  shopId: string;
  currency: string;
  items: StorefrontCartLineDto[];
  itemCount: number;
  subtotal: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toStorefrontCart(
  cart: Cart,
  lines: StorefrontCartLineDto[],
  subtotal: string,
): StorefrontCartDto {
  return {
    token: cart.token,
    shopId: cart.shopId,
    currency: cart.currency,
    items: lines,
    itemCount: lines.reduce((acc, l) => acc + l.quantity, 0),
    subtotal,
    expiresAt: cart.expiresAt ? cart.expiresAt.toISOString() : null,
    createdAt: cart.createdAt.toISOString(),
    updatedAt: cart.updatedAt.toISOString(),
  };
}
