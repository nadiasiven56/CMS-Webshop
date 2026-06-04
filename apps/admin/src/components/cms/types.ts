/**
 * CMS-DTO's — gespiegeld aan de backend-serializers
 * (`apps/api/src/routes/cms/_serialize.ts`). Alleen wat de admin-UI nodig heeft.
 */

// ─── Pages ──────────────────────────────────────────────────────
export type PageStatus = 'draft' | 'published';

export interface CmsPageDto {
  id: string;
  shopId: string;
  slug: string;
  title: string;
  status: PageStatus;
  template: string;
  blocks: PageBlock[];
  seo: SeoFields;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeoFields {
  title?: string;
  description?: string;
  ogImage?: string;
  noindex?: boolean;
  [k: string]: unknown;
}

// ─── Blocks (page-builder, vorm-vrij jsonb) ─────────────────────
export type BlockType = 'hero' | 'richtext' | 'banner' | 'product-grid' | 'html';

/** Een enkel block in een pagina. `id` is client-only voor stabiele keys. */
export interface PageBlock {
  id: string;
  type: BlockType;
  /** Vrije inhoud per block-type. */
  data: Record<string, unknown>;
}

// ─── Blog ───────────────────────────────────────────────────────
export type BlogStatus = 'draft' | 'published' | 'archived';

export interface BlogPostDto {
  id: string;
  shopId: string;
  slug: string;
  title: string;
  excerpt: string | null;
  bodyHtml: string | null;
  coverImage: string | null;
  status: BlogStatus;
  author: string | null;
  tags: string[];
  seo: SeoFields;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Menus + items ──────────────────────────────────────────────
export interface CmsMenuItemDto {
  id: string;
  menuId: string;
  parentId: string | null;
  label: string;
  url: string;
  position: number;
  createdAt: string;
  children?: CmsMenuItemDto[];
}

export interface CmsMenuDto {
  id: string;
  shopId: string;
  location: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  items?: CmsMenuItemDto[];
}

// ─── Media ──────────────────────────────────────────────────────
export interface CmsMediaDto {
  id: string;
  shopId: string | null;
  url: string;
  filename: string;
  mime: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  alt: string | null;
  folder: string;
  createdAt: string;
}

// ─── List-envelope (pages/blog/media) ──────────────────────────
export interface ListResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
