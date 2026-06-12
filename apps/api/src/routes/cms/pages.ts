/**
 * CMS-pages — `/api/cms/pages`.
 *
 * Page-builder pagina's per shop. `blocks` = geordende jsonb-array van
 * block-objecten, `seo` = jsonb. status draft|published. UNIQUE(shop_id, slug).
 *
 *   GET    /api/cms/pages?shop=<ref>[&status=&search=&limit=&offset=]
 *   GET    /api/cms/pages/:id?shop=<ref>
 *   POST   /api/cms/pages           (body.shopId of ?shop=)
 *   PATCH  /api/cms/pages/:id
 *   DELETE /api/cms/pages/:id
 *
 * Auth: requireAuth (gezet op de parent-router). Writes via runInTransactionWithAudit.
 */
import { Hono } from 'hono';
import { and, desc, eq, ilike, count } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { cmsPages } from '../../db/schema/index.js';
import type { AuthVariables } from '../../middleware/auth.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { isUuid, resolveShopFromRequest, resolveShopId } from './_validate.js';
import { invalid, shopError, isUniqueViolation } from './_errors.js';
import { slugify } from './_slug.js';
import { toPageDto } from './_serialize.js';

export const pageRoutes = new Hono<{ Variables: AuthVariables }>();

const seoSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    ogImage: z.string().optional(),
    noindex: z.boolean().optional(),
  })
  .passthrough();

const statusEnum = z.enum(['draft', 'published']);

const listQuery = z.object({
  status: statusEnum.optional(),
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const createBody = z.object({
  shopId: z.string().optional(),
  slug: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  status: statusEnum.default('draft'),
  template: z.string().trim().min(1).default('default'),
  blocks: z.array(z.unknown()).default([]),
  seo: seoSchema.default({}),
  publishedAt: z.string().datetime().nullable().optional(),
});

const patchBody = z.object({
  slug: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  status: statusEnum.optional(),
  template: z.string().trim().min(1).optional(),
  blocks: z.array(z.unknown()).optional(),
  seo: seoSchema.optional(),
  publishedAt: z.string().datetime().nullable().optional(),
});

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

// ─── LIST ────────────────────────────────────────────────────
pageRoutes.get('/', async (c) => {
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const { status, search, limit, offset } = parsed.data;

  const conds = [eq(cmsPages.shopId, shopId)];
  if (status) conds.push(eq(cmsPages.status, status));
  if (search) conds.push(ilike(cmsPages.title, `%${search}%`));
  const where = and(...conds);

  const rows = await db
    .select()
    .from(cmsPages)
    .where(where)
    .orderBy(desc(cmsPages.updatedAt))
    .limit(limit)
    .offset(offset);

  const [{ c: total } = { c: 0 }] = await db
    .select({ c: count() })
    .from(cmsPages)
    .where(where);

  return c.json({ items: rows.map(toPageDto), total: Number(total), limit, offset });
});

// ─── GET by id ───────────────────────────────────────────────
pageRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const [row] = await db
    .select()
    .from(cmsPages)
    .where(and(eq(cmsPages.id, id), eq(cmsPages.shopId, shopId)))
    .limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ page: toPageDto(row) });
});

// ─── CREATE ──────────────────────────────────────────────────
pageRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = createBody.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const input = parsed.data;

  const shopRef = input.shopId ?? c.req.query('shop') ?? c.req.header('x-shop-id');
  const shopId = await resolveShopId(shopRef, user);
  if (!shopId) return shopError(c, !!shopRef);

  const slug = slugify(input.slug ?? input.title) || slugify(input.title);
  if (!slug) return invalid(c, { slug: ['kon geen geldige slug afleiden'] });

  try {
    const page = await runInTransactionWithAudit(async (tx, audit) => {
      const [row] = await tx
        .insert(cmsPages)
        .values({
          shopId,
          slug,
          title: input.title,
          status: input.status,
          template: input.template,
          blocks: input.blocks,
          seo: input.seo,
          publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
        })
        .returning();
      if (!row) throw new Error('cms_page insert returned no row');
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'create',
        entityType: 'cms_page',
        entityId: row.id,
        after: { id: row.id, shopId, slug: row.slug, status: row.status },
        ip: ip(c),
      });
      return row;
    });
    return c.json({ page: toPageDto(page) }, 201);
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
pageRoutes.patch('/:id', async (c) => {
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
        .from(cmsPages)
        .where(and(eq(cmsPages.id, id), eq(cmsPages.shopId, shopId)))
        .limit(1);
      if (!existing) return null;

      const patch: Partial<typeof cmsPages.$inferInsert> = { updatedAt: new Date() };
      if (input.slug !== undefined) {
        const s = slugify(input.slug);
        if (!s) throw new SlugError();
        patch.slug = s;
      }
      if (input.title !== undefined) patch.title = input.title;
      if (input.status !== undefined) patch.status = input.status;
      if (input.template !== undefined) patch.template = input.template;
      if (input.blocks !== undefined) patch.blocks = input.blocks;
      if (input.seo !== undefined) patch.seo = input.seo;
      if (input.publishedAt !== undefined) {
        patch.publishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
      }

      const [after] = await tx
        .update(cmsPages)
        .set(patch)
        .where(eq(cmsPages.id, id))
        .returning();
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'update',
        entityType: 'cms_page',
        entityId: id,
        before: { slug: existing.slug, status: existing.status, title: existing.title },
        after: after ? { slug: after.slug, status: after.status, title: after.title } : null,
        ip: ip(c),
      });
      return after ?? null;
    });
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json({ page: toPageDto(result) });
  } catch (err) {
    if (err instanceof SlugError) return invalid(c, { slug: ['kon geen geldige slug afleiden'] });
    if (isUniqueViolation(err)) {
      return c.json({ error: 'slug_conflict', message: 'Slug bestaat al in deze shop.' }, 409);
    }
    throw err;
  }
});

// ─── DELETE ──────────────────────────────────────────────────
pageRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [existing] = await tx
      .select()
      .from(cmsPages)
      .where(and(eq(cmsPages.id, id), eq(cmsPages.shopId, shopId)))
      .limit(1);
    if (!existing) return null;
    await tx.delete(cmsPages).where(eq(cmsPages.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'cms_page',
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
