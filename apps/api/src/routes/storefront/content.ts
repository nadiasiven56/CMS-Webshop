/**
 * Storefront content (CMS).
 *
 *   GET /pages/:slug   — gepubliceerde page van de shop.
 *   GET /menus         — alle menus (met geneste items) van de shop.
 *   GET /blog          — gepubliceerde blog-posts (lijst, zonder body).
 *   GET /blog/:slug    — gepubliceerde blog-post detail (met body).
 *
 * Alleen status='published'. Globale blocks worden meegestuurd bij /pages
 * (active=true) zodat een storefront header/footer kan renderen.
 */
import type { Context } from 'hono';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import {
  cmsPages,
  cmsBlocks,
  cmsMenus,
  cmsMenuItems,
  blogPosts,
  type Shop,
} from '../../db/schema/index.js';
import {
  toStorefrontPage,
  toStorefrontBlock,
  toStorefrontMenu,
  toStorefrontBlogPost,
} from './_serialize.js';

export async function getPage(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const slug = c.req.param('slug');
  if (!slug) return c.json({ error: 'invalid_request' }, 400);

  const [page] = await db
    .select()
    .from(cmsPages)
    .where(
      and(
        eq(cmsPages.shopId, shop.id),
        eq(cmsPages.slug, slug),
        eq(cmsPages.status, 'published'),
      ),
    )
    .limit(1);

  if (!page) return c.json({ error: 'page_not_found' }, 404);

  // Globale actieve blocks meesturen (header/footer/banners).
  const blocks = await db
    .select()
    .from(cmsBlocks)
    .where(and(eq(cmsBlocks.shopId, shop.id), eq(cmsBlocks.active, true)));

  return c.json({
    page: toStorefrontPage(page),
    blocks: blocks.map(toStorefrontBlock),
  });
}

export async function listMenus(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;

  const menus = await db
    .select()
    .from(cmsMenus)
    .where(eq(cmsMenus.shopId, shop.id))
    .orderBy(asc(cmsMenus.location), asc(cmsMenus.name));

  const menuIds = menus.map((m) => m.id);
  const items =
    menuIds.length > 0
      ? await db
          .select()
          .from(cmsMenuItems)
          .where(inArray(cmsMenuItems.menuId, menuIds))
          .orderBy(asc(cmsMenuItems.position))
      : [];

  const itemsByMenu = new Map<string, typeof items>();
  for (const it of items) {
    const arr = itemsByMenu.get(it.menuId) ?? [];
    arr.push(it);
    itemsByMenu.set(it.menuId, arr);
  }

  return c.json({
    menus: menus.map((m) => toStorefrontMenu(m, itemsByMenu.get(m.id) ?? [])),
  });
}

const BlogListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(12),
  offset: z.coerce.number().int().min(0).optional().default(0),
  tag: z.string().trim().min(1).optional(),
});

export async function listBlog(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const parsed = BlogListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset, tag } = parsed.data;

  const all = await db
    .select()
    .from(blogPosts)
    .where(and(eq(blogPosts.shopId, shop.id), eq(blogPosts.status, 'published')))
    .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.createdAt));

  const filtered = tag ? all.filter((p) => (p.tags ?? []).includes(tag)) : all;
  const total = filtered.length;
  const pageRows = filtered.slice(offset, offset + limit);

  return c.json({
    items: pageRows.map((p) => toStorefrontBlogPost(p, false)),
    total,
    limit,
    offset,
  });
}

export async function getBlogPost(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const slug = c.req.param('slug');
  if (!slug) return c.json({ error: 'invalid_request' }, 400);

  const [post] = await db
    .select()
    .from(blogPosts)
    .where(
      and(
        eq(blogPosts.shopId, shop.id),
        eq(blogPosts.slug, slug),
        eq(blogPosts.status, 'published'),
      ),
    )
    .limit(1);

  if (!post) return c.json({ error: 'blog_post_not_found' }, 404);

  return c.json({ post: toStorefrontBlogPost(post, true) });
}
