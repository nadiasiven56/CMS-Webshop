/**
 * CMS-blocks — `/api/cms/blocks`.
 *
 * Herbruikbare/globale secties per shop (header, footer, banners, hero, ...).
 * key+type+content(jsonb)+active. UNIQUE(shop_id, key).
 *
 *   GET    /api/cms/blocks?shop=<ref>[&type=&active=]
 *   GET    /api/cms/blocks/:id?shop=<ref>
 *   POST   /api/cms/blocks
 *   PATCH  /api/cms/blocks/:id
 *   DELETE /api/cms/blocks/:id
 */
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { cmsBlocks } from '../../db/schema/index.js';
import type { AuthVariables } from '../../middleware/auth.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { isUuid, resolveShopFromRequest, resolveShopId } from './_validate.js';
import { invalid, shopError, isUniqueViolation } from './_errors.js';
import { toBlockDto } from './_serialize.js';

export const blockRoutes = new Hono<{ Variables: AuthVariables }>();

const BLOCK_TYPES = ['hero', 'richtext', 'banner', 'product-grid', 'html'] as const;

const listQuery = z.object({
  type: z.enum(BLOCK_TYPES).optional(),
  active: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

const createBody = z.object({
  shopId: z.string().optional(),
  key: z.string().trim().min(1).max(120),
  // type is bewust open (default-set is conventie, niet hard) maar we valideren
  // tegen de bekende set + laten custom toe als string.
  type: z.string().trim().min(1).max(40),
  content: z.record(z.unknown()).default({}),
  active: z.boolean().default(true),
});

const patchBody = z.object({
  key: z.string().trim().min(1).max(120).optional(),
  type: z.string().trim().min(1).max(40).optional(),
  content: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
});

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

// ─── LIST ────────────────────────────────────────────────────
blockRoutes.get('/', async (c) => {
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const { type, active } = parsed.data;

  const conds = [eq(cmsBlocks.shopId, shopId)];
  if (type) conds.push(eq(cmsBlocks.type, type));
  if (active !== undefined) conds.push(eq(cmsBlocks.active, active));

  const rows = await db
    .select()
    .from(cmsBlocks)
    .where(and(...conds))
    .orderBy(desc(cmsBlocks.updatedAt));

  return c.json({ items: rows.map(toBlockDto) });
});

// ─── GET by id ───────────────────────────────────────────────
blockRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const [row] = await db
    .select()
    .from(cmsBlocks)
    .where(and(eq(cmsBlocks.id, id), eq(cmsBlocks.shopId, shopId)))
    .limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ block: toBlockDto(row) });
});

// ─── CREATE ──────────────────────────────────────────────────
blockRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = createBody.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const input = parsed.data;

  const shopRef = input.shopId ?? c.req.query('shop') ?? c.req.header('x-shop-id');
  const shopId = await resolveShopId(shopRef, user);
  if (!shopId) return shopError(c, !!shopRef);

  try {
    const block = await runInTransactionWithAudit(async (tx, audit) => {
      const [row] = await tx
        .insert(cmsBlocks)
        .values({
          shopId,
          key: input.key,
          type: input.type,
          content: input.content,
          active: input.active,
        })
        .returning();
      if (!row) throw new Error('cms_block insert returned no row');
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'create',
        entityType: 'cms_block',
        entityId: row.id,
        after: { id: row.id, shopId, key: row.key, type: row.type },
        ip: ip(c),
      });
      return row;
    });
    return c.json({ block: toBlockDto(block) }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json(
        { error: 'key_conflict', message: `Block-key '${input.key}' bestaat al in deze shop.` },
        409,
      );
    }
    throw err;
  }
});

// ─── PATCH ───────────────────────────────────────────────────
blockRoutes.patch('/:id', async (c) => {
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
        .from(cmsBlocks)
        .where(and(eq(cmsBlocks.id, id), eq(cmsBlocks.shopId, shopId)))
        .limit(1);
      if (!existing) return null;

      const patch: Partial<typeof cmsBlocks.$inferInsert> = { updatedAt: new Date() };
      if (input.key !== undefined) patch.key = input.key;
      if (input.type !== undefined) patch.type = input.type;
      if (input.content !== undefined) patch.content = input.content;
      if (input.active !== undefined) patch.active = input.active;

      const [after] = await tx
        .update(cmsBlocks)
        .set(patch)
        .where(eq(cmsBlocks.id, id))
        .returning();
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'update',
        entityType: 'cms_block',
        entityId: id,
        before: { key: existing.key, type: existing.type, active: existing.active },
        after: after ? { key: after.key, type: after.type, active: after.active } : null,
        ip: ip(c),
      });
      return after ?? null;
    });
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json({ block: toBlockDto(result) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: 'key_conflict', message: 'Block-key bestaat al in deze shop.' }, 409);
    }
    throw err;
  }
});

// ─── DELETE ──────────────────────────────────────────────────
blockRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [existing] = await tx
      .select()
      .from(cmsBlocks)
      .where(and(eq(cmsBlocks.id, id), eq(cmsBlocks.shopId, shopId)))
      .limit(1);
    if (!existing) return null;
    await tx.delete(cmsBlocks).where(eq(cmsBlocks.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'cms_block',
      entityId: id,
      before: { key: existing.key, type: existing.type },
      ip: ip(c),
    });
    return existing;
  });
  if (!result) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});
