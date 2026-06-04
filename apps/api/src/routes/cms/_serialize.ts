/**
 * Serializers — Drizzle-row → API-DTO voor de CMS-module.
 *
 * Conventie (zoals products/_serialize.ts):
 *   - Date → ISO-string (`.toISOString()`)
 *   - jsonb shape stabiel teruggeven
 *   - text[] blijft array
 */
import type {
  CmsPage,
  CmsBlock,
  CmsMenu,
  CmsMenuItem,
  BlogPost,
  CmsMedia,
  CmsRedirect,
} from '../../db/schema/index.js';

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ─── Pages ──────────────────────────────────────────────────────
export interface CmsPageDto {
  id: string;
  shopId: string;
  slug: string;
  title: string;
  status: string;
  template: string;
  blocks: unknown[];
  seo: Record<string, unknown>;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPageDto(p: CmsPage): CmsPageDto {
  return {
    id: p.id,
    shopId: p.shopId,
    slug: p.slug,
    title: p.title,
    status: p.status,
    template: p.template,
    blocks: p.blocks ?? [],
    seo: (p.seo ?? {}) as Record<string, unknown>,
    publishedAt: iso(p.publishedAt),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ─── Blocks ─────────────────────────────────────────────────────
export interface CmsBlockDto {
  id: string;
  shopId: string;
  key: string;
  type: string;
  content: Record<string, unknown>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toBlockDto(b: CmsBlock): CmsBlockDto {
  return {
    id: b.id,
    shopId: b.shopId,
    key: b.key,
    type: b.type,
    content: (b.content ?? {}) as Record<string, unknown>,
    active: b.active,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
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

export function toMenuItemDto(i: CmsMenuItem): CmsMenuItemDto {
  return {
    id: i.id,
    menuId: i.menuId,
    parentId: i.parentId,
    label: i.label,
    url: i.url,
    position: i.position,
    createdAt: i.createdAt.toISOString(),
  };
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

export function toMenuDto(m: CmsMenu): CmsMenuDto {
  return {
    id: m.id,
    shopId: m.shopId,
    location: m.location,
    name: m.name,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/**
 * Bouw een geneste boom van menu-items op `parentId`, gesorteerd op `position`
 * (en `createdAt` als tiebreak — die volgorde komt al uit de query).
 * Items met een parent die niet in de set zit worden als root behandeld
 * (defensief tegen verweesde refs door `set null`).
 */
export function nestMenuItems(items: CmsMenuItem[]): CmsMenuItemDto[] {
  const dtos = items.map(toMenuItemDto);
  const byId = new Map<string, CmsMenuItemDto>();
  for (const d of dtos) {
    d.children = [];
    byId.set(d.id, d);
  }
  const roots: CmsMenuItemDto[] = [];
  for (const d of dtos) {
    const parent = d.parentId ? byId.get(d.parentId) : undefined;
    if (parent) {
      parent.children!.push(d);
    } else {
      roots.push(d);
    }
  }
  const sortRec = (arr: CmsMenuItemDto[]): void => {
    arr.sort((a, b) => a.position - b.position);
    for (const node of arr) if (node.children) sortRec(node.children);
  };
  sortRec(roots);
  return roots;
}

// ─── Blog ───────────────────────────────────────────────────────
export interface BlogPostDto {
  id: string;
  shopId: string;
  slug: string;
  title: string;
  excerpt: string | null;
  bodyHtml: string | null;
  coverImage: string | null;
  status: string;
  author: string | null;
  tags: string[];
  seo: Record<string, unknown>;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toBlogPostDto(b: BlogPost): BlogPostDto {
  return {
    id: b.id,
    shopId: b.shopId,
    slug: b.slug,
    title: b.title,
    excerpt: b.excerpt,
    bodyHtml: b.bodyHtml,
    coverImage: b.coverImage,
    status: b.status,
    author: b.author,
    tags: b.tags ?? [],
    seo: (b.seo ?? {}) as Record<string, unknown>,
    publishedAt: iso(b.publishedAt),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
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

export function toMediaDto(m: CmsMedia): CmsMediaDto {
  return {
    id: m.id,
    shopId: m.shopId,
    url: m.url,
    filename: m.filename,
    mime: m.mime,
    sizeBytes: m.sizeBytes,
    width: m.width,
    height: m.height,
    alt: m.alt,
    folder: m.folder,
    createdAt: m.createdAt.toISOString(),
  };
}

// ─── Redirects ──────────────────────────────────────────────────
export interface CmsRedirectDto {
  id: string;
  shopId: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  createdAt: string;
}

export function toRedirectDto(r: CmsRedirect): CmsRedirectDto {
  return {
    id: r.id,
    shopId: r.shopId,
    fromPath: r.fromPath,
    toPath: r.toPath,
    statusCode: r.statusCode,
    createdAt: r.createdAt.toISOString(),
  };
}
