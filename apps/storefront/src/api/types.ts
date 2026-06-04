/**
 * Publieke storefront-API DTO's — gespiegeld aan
 * apps/api/src/routes/storefront/_serialize.ts (de PUBLIEKE shape).
 * Geld komt als string (numeric) uit de API.
 */

export interface Branding {
  theme?: string;
  primaryColor?: string;
  accentColor?: string;
  [key: string]: unknown;
}

export interface Shop {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  locale: string;
  currency: string;
  branding: Branding;
  supportEmail: string | null;
}

export interface ProductListItem {
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

export interface ProductListResponse {
  items: ProductListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface Variant {
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

export interface ProductImage {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

export interface ProductDetail {
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
  variants: Variant[];
  images: ProductImage[];
}

/** CMS-blocks zijn losjes getypeerd — type bepaalt de overige velden. */
export interface CmsPageBlock {
  type: string;
  [key: string]: unknown;
}

export interface CmsPage {
  slug: string;
  title: string;
  template: string;
  blocks: CmsPageBlock[];
  seo: Record<string, unknown>;
  publishedAt: string | null;
}

export interface GlobalBlock {
  key: string;
  type: string;
  content: Record<string, unknown>;
}

export interface PageResponse {
  page: CmsPage;
  blocks: GlobalBlock[];
}

export interface MenuItem {
  id: string;
  parentId: string | null;
  label: string;
  url: string;
  position: number;
  children: MenuItem[];
}

export interface Menu {
  id: string;
  location: string;
  name: string;
  items: MenuItem[];
}

export interface BlogPost {
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

export interface BlogListResponse {
  items: BlogPost[];
  total: number;
  limit: number;
  offset: number;
}

export interface CartLine {
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

export interface Cart {
  token: string;
  shopId: string;
  currency: string;
  items: CartLine[];
  itemCount: number;
  subtotal: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderResult {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    financialStatus: string;
    currency: string;
    subtotal: string;
    shippingTotal: string;
    taxTotal: string;
    grandTotal: string;
    email: string;
    placedAt: string | null;
    createdAt: string;
  };
  payment: {
    provider: string;
    status: string;
    reference: string;
    amount: string;
  };
}

export type SortOption =
  | 'position'
  | 'newest'
  | 'price_asc'
  | 'price_desc'
  | 'title';

export interface CheckoutAddress {
  name?: string;
  company?: string;
  line1: string;
  line2?: string;
  postcode: string;
  city: string;
  province?: string;
  country?: string;
  phone?: string;
}

export interface CheckoutBody {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  acceptsMarketing?: boolean;
  note?: string;
  shippingAddress: CheckoutAddress;
  billingAddress?: CheckoutAddress;
  shippingTotal?: string;
}
