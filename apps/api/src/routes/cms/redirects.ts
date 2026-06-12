/**
 * Redirects — `/api/cms/redirects`.
 *
 * from_path → to_path met status_code (301/302/307/308). Per shop.
 * UNIQUE(shop_id, from_path).
 *
 *   GET    /api/cms/redirects?shop=<ref>[&search=]
 *   GET    /api/cms/redirects/:id?shop=<ref>
 *   POST   /api/cms/redirects
 *   PATCH  /api/cms/redirects/:id
 *   DELETE /api/cms/redirects/:id
 */
import { Hono } from 'hono';
import { and, desc, eq, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { cmsRedirects } from '../../db/schema/index.js';
import type { AuthVariables } from '../../middleware/auth.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { isUuid, resolveShopFromRequest, resolveShopId } from './_validate.js';
import { invalid, shopError, isUniqueViolation } from './_errors.js';
import { toRedirectDto } from './_serialize.js';

export const redirectRoutes = new Hono<{ Variables: AuthVariables }>();

const STATUS_CODES = [301, 302, 307, 308] as const;

const listQuery = z.object({
  search: z.string().trim().min(1).optional(),
});

// from_path normaliseren: forceer leading slash, trim trailing slash (behalve root).
function normalizePath(p: string): string {
  let s = p.trim();
  if (!s.startsWith('/')) s = '/' + s;
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

const createBody = z.object({
  shopId: z.string().optional(),
  fromPath: z.string().trim().min(1).max(2000),
  toPath: z.string().trim().min(1).max(2000),
  statusCode: z
    .number()
    .int()
    .refine((v) => (STATUS_CODES as readonly number[]).includes(v), {
      message: 'status_code moet 301|302|307|308 zijn',
    })
    .default(301),
});

const patchBody = z.object({
  fromPath: z.string().trim().min(1).max(2000).optional(),
  toPath: z.string().trim().min(1).max(2000).optional(),
  statusCode: z
    .number()
    .int()
    .refine((v) => (STATUS_CODES as readonly number[]).includes(v), {
      message: 'status_code moet 301|302|307|308 zijn',
    })
    .optional(),
});

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

// ─── LIST ────────────────────────────────────────────────────
redirectRoutes.get('/', async (c) => {
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const { search } = parsed.data;

  const conds = [eq(cmsRedirects.shopId, shopId)];
  if (search) conds.push(ilike(cmsRedirects.fromPath, `%${search}%`));

  const rows = await db
    .select()
    .from(cmsRedirects)
    .where(and(...conds))
    .orderBy(desc(cmsRedirects.createdAt));

  return c.json({ items: rows.map(toRedirectDto) });
});

// ─── GET by id ───────────────────────────────────────────────
redirectRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const [row] = await db
    .select()
    .from(cmsRedirects)
    .where(and(eq(cmsRedirects.id, id), eq(cmsRedirects.shopId, shopId)))
    .limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ redirect: toRedirectDto(row) });
});

// ─── CREATE ──────────────────────────────────────────────────
redirectRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = createBody.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const input = parsed.data;

  const shopRef = input.shopId ?? c.req.query('shop') ?? c.req.header('x-shop-id');
  const shopId = await resolveShopId(shopRef, user);
  if (!shopId) return shopError(c, !!shopRef);

  const fromPath = normalizePath(input.fromPath);

  try {
    const redirect = await runInTransactionWithAudit(async (tx, audit) => {
      const [row] = await tx
        .insert(cmsRedirects)
        .values({
          shopId,
          fromPath,
          toPath: input.toPath.trim(),
          statusCode: input.statusCode,
        })
        .returning();
      if (!row) throw new Error('cms_redirect insert returned no row');
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'create',
        entityType: 'cms_redirect',
        entityId: row.id,
        after: { id: row.id, shopId, fromPath: row.fromPath, toPath: row.toPath },
        ip: ip(c),
      });
      return row;
    });
    return c.json({ redirect: toRedirectDto(redirect) }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json(
        { error: 'from_path_conflict', message: `Redirect voor '${fromPath}' bestaat al in deze shop.` },
        409,
      );
    }
    throw err;
  }
});

// ─── PATCH ───────────────────────────────────────────────────
redirectRoutes.patch('/:id', async (c) => {
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
        .from(cmsRedirects)
        .where(and(eq(cmsRedirects.id, id), eq(cmsRedirects.shopId, shopId)))
        .limit(1);
      if (!existing) return null;

      const patch: Partial<typeof cmsRedirects.$inferInsert> = {};
      if (input.fromPath !== undefined) patch.fromPath = normalizePath(input.fromPath);
      if (input.toPath !== undefined) patch.toPath = input.toPath.trim();
      if (input.statusCode !== undefined) patch.statusCode = input.statusCode;

      const [after] = await tx
        .update(cmsRedirects)
        .set(patch)
        .where(eq(cmsRedirects.id, id))
        .returning();
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'update',
        entityType: 'cms_redirect',
        entityId: id,
        before: { fromPath: existing.fromPath, toPath: existing.toPath },
        after: after ? { fromPath: after.fromPath, toPath: after.toPath } : null,
        ip: ip(c),
      });
      return after ?? null;
    });
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json({ redirect: toRedirectDto(result) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: 'from_path_conflict', message: 'from_path bestaat al in deze shop.' }, 409);
    }
    throw err;
  }
});

// ─── DELETE ──────────────────────────────────────────────────
redirectRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [existing] = await tx
      .select()
      .from(cmsRedirects)
      .where(and(eq(cmsRedirects.id, id), eq(cmsRedirects.shopId, shopId)))
      .limit(1);
    if (!existing) return null;
    await tx.delete(cmsRedirects).where(eq(cmsRedirects.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'cms_redirect',
      entityId: id,
      before: { fromPath: existing.fromPath, toPath: existing.toPath },
      ip: ip(c),
    });
    return existing;
  });
  if (!result) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});
