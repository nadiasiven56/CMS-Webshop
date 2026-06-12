/**
 * Blog — `/api/cms/blog`.
 *
 * blog_posts per shop: slug/title/excerpt/body_html/cover_image/status/author/
 * tags[]/seo. UNIQUE(shop_id, slug).
 *
 *   GET    /api/cms/blog?shop=<ref>[&status=&tag=&search=&limit=&offset=]
 *   GET    /api/cms/blog/:id?shop=<ref>
 *   POST   /api/cms/blog
 *   PATCH  /api/cms/blog/:id
 *   DELETE /api/cms/blog/:id
 */
import { Hono } from 'hono';
import { and, desc, eq, ilike, sql, count } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { blogPosts } from '../../db/schema/index.js';
import type { AuthVariables } from '../../middleware/auth.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { isUuid, resolveShopFromRequest, resolveShopId } from './_validate.js';
import { invalid, shopError, isUniqueViolation } from './_errors.js';
import { slugify } from './_slug.js';
import { toBlogPostDto } from './_serialize.js';

export const blogRoutes = new Hono<{ Variables: AuthVariables }>();

const seoSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    ogImage: z.string().optional(),
    noindex: z.boolean().optional(),
  })
  .passthrough();

const statusEnum = z.enum(['draft', 'published', 'archived']);

const listQuery = z.object({
  status: statusEnum.optional(),
  tag: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const createBody = z.object({
  shopId: z.string().optional(),
  slug: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  excerpt: z.string().nullable().optional(),
  bodyHtml: z.string().nullable().optional(),
  coverImage: z.string().nullable().optional(),
  status: statusEnum.default('draft'),
  author: z.string().nullable().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  seo: seoSchema.default({}),
  publishedAt: z.string().datetime().nullable().optional(),
});

const patchBody = z.object({
  slug: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  excerpt: z.string().nullable().optional(),
  bodyHtml: z.string().nullable().optional(),
  coverImage: z.string().nullable().optional(),
  status: statusEnum.optional(),
  author: z.string().nullable().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  seo: seoSchema.optional(),
  publishedAt: z.string().datetime().nullable().optional(),
});

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

// ─── LIST ────────────────────────────────────────────────────
blogRoutes.get('/', async (c) => {
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const { status, tag, search, limit, offset } = parsed.data;

  const conds = [eq(blogPosts.shopId, shopId)];
  if (status) conds.push(eq(blogPosts.status, status));
  if (search) conds.push(ilike(blogPosts.title, `%${search}%`));
  // tag-match op text[]: `tag = ANY(...)` zou verboden zijn; gebruik de
  // array-contains operator van postgres via sql-fragment op de KOLOM (geen
  // JS-array → veilig, geen postgres-js ANY-bug).
  if (tag) conds.push(sql`${blogPosts.tags} @> ARRAY[${tag}]::text[]`);
  const where = and(...conds);

  const rows = await db
    .select()
    .from(blogPosts)
    .where(where)
    .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.updatedAt))
    .limit(limit)
    .offset(offset);

  const [{ c: total } = { c: 0 }] = await db
    .select({ c: count() })
    .from(blogPosts)
    .where(where);

  return c.json({ items: rows.map(toBlogPostDto), total: Number(total), limit, offset });
});

// ─── GET by id ───────────────────────────────────────────────
blogRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const [row] = await db
    .select()
    .from(blogPosts)
    .where(and(eq(blogPosts.id, id), eq(blogPosts.shopId, shopId)))
    .limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ post: toBlogPostDto(row) });
});

// ─── CREATE ──────────────────────────────────────────────────
blogRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = createBody.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const input = parsed.data;

  const shopRef = input.shopId ?? c.req.query('shop') ?? c.req.header('x-shop-id');
  const shopId = await resolveShopId(shopRef, user);
  if (!shopId) return shopError(c, !!shopRef);

  const slug = slugify(input.slug ?? input.title);
  if (!slug) return invalid(c, { slug: ['kon geen geldige slug afleiden'] });

  try {
    const post = await runInTransactionWithAudit(async (tx, audit) => {
      const [row] = await tx
        .insert(blogPosts)
        .values({
          shopId,
          slug,
          title: input.title,
          excerpt: input.excerpt ?? null,
          bodyHtml: input.bodyHtml ?? null,
          coverImage: input.coverImage ?? null,
          status: input.status,
          author: input.author ?? null,
          tags: input.tags,
          seo: input.seo,
          publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
        })
        .returning();
      if (!row) throw new Error('blog_post insert returned no row');
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'create',
        entityType: 'blog_post',
        entityId: row.id,
        after: { id: row.id, shopId, slug: row.slug, status: row.status },
        ip: ip(c),
      });
      return row;
    });
    return c.json({ post: toBlogPostDto(post) }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json(
        { error: 'slug_conflict', message: `Slug '${slug}' bestaat al in deze shop.` },
        409,
      );
    }
    throw err;
  }
});

// ─── PATCH ───────────────────────────────────────────────────
blogRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = patchBody.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const input = parsed.data;

  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  try {
    const result = await runInTransactionWithAudit(async (tx, audit) => {
      const [existing] = await tx
        .select()
        .from(blogPosts)
        .where(and(eq(blogPosts.id, id), eq(blogPosts.shopId, shopId)))
        .limit(1);
      if (!existing) return null;

      const patch: Partial<typeof blogPosts.$inferInsert> = { updatedAt: new Date() };
      if (input.slug !== undefined) {
        const s = slugify(input.slug);
        if (!s) throw new SlugError();
        patch.slug = s;
      }
      if (input.title !== undefined) patch.title = input.title;
      if (input.excerpt !== undefined) patch.excerpt = input.excerpt;
      if (input.bodyHtml !== undefined) patch.bodyHtml = input.bodyHtml;
      if (input.coverImage !== undefined) patch.coverImage = input.coverImage;
      if (input.status !== undefined) patch.status = input.status;
      if (input.author !== undefined) patch.author = input.author;
      if (input.tags !== undefined) patch.tags = input.tags;
      if (input.seo !== undefined) patch.seo = input.seo;
      if (input.publishedAt !== undefined) {
        patch.publishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
      }

      const [after] = await tx
        .update(blogPosts)
        .set(patch)
        .where(eq(blogPosts.id, id))
        .returning();
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'update',
        entityType: 'blog_post',
        entityId: id,
        before: { slug: existing.slug, status: existing.status, title: existing.title },
        after: after ? { slug: after.slug, status: after.status, title: after.title } : null,
        ip: ip(c),
      });
      return after ?? null;
    });
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json({ post: toBlogPostDto(result) });
  } catch (err) {
    if (err instanceof SlugError) return invalid(c, { slug: ['kon geen geldige slug afleiden'] });
    if (isUniqueViolation(err)) {
      return c.json({ error: 'slug_conflict', message: 'Slug bestaat al in deze shop.' }, 409);
    }
    throw err;
  }
});

// ─── DELETE ──────────────────────────────────────────────────
blogRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [existing] = await tx
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.id, id), eq(blogPosts.shopId, shopId)))
      .limit(1);
    if (!existing) return null;
    await tx.delete(blogPosts).where(eq(blogPosts.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'blog_post',
      entityId: id,
      before: { slug: existing.slug, title: existing.title },
      ip: ip(c),
    });
    return existing;
  });
  if (!result) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

class SlugError extends Error {}
