/**
 * CMS-menus + menu-items — `/api/cms/menus`.
 *
 * Navigatie per shop+locatie. Items zijn self-nesting via parent_id; lezen
 * geeft een geneste boom (gesorteerd op position). UNIQUE(shop_id, location, name).
 *
 * Menus:
 *   GET    /api/cms/menus?shop=<ref>[&location=]
 *   GET    /api/cms/menus/:id?shop=<ref>            (incl. geneste items)
 *   POST   /api/cms/menus
 *   PATCH  /api/cms/menus/:id
 *   DELETE /api/cms/menus/:id                       (cascade → items weg)
 *
 * Menu-items (genest onder een menu):
 *   POST   /api/cms/menus/:id/items
 *   PATCH  /api/cms/menus/:id/items/:itemId
 *   DELETE /api/cms/menus/:id/items/:itemId
 *   PUT    /api/cms/menus/:id/items                 (bulk-replace = reorder/restructure)
 */
import { Hono } from 'hono';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { cmsMenus, cmsMenuItems } from '../../db/schema/index.js';
import type { AuthVariables } from '../../middleware/auth.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { isUuid, resolveShopFromRequest, resolveShopId } from './_validate.js';
import { invalid, shopError, isUniqueViolation } from './_errors.js';
import { toMenuDto, toMenuItemDto, nestMenuItems } from './_serialize.js';

export const menuRoutes = new Hono<{ Variables: AuthVariables }>();

const LOCATIONS = ['header', 'footer', 'sidebar'] as const;

const listQuery = z.object({
  location: z.string().trim().min(1).optional(),
});

const createMenuBody = z.object({
  shopId: z.string().optional(),
  location: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
});

const patchMenuBody = z.object({
  location: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

const itemBody = z.object({
  parentId: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(1000),
  position: z.number().int().min(0).default(0),
});

const itemPatchBody = z.object({
  parentId: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1).max(200).optional(),
  url: z.string().trim().min(1).max(1000).optional(),
  position: z.number().int().min(0).optional(),
});

// Bulk-replace: complete nieuwe item-set (flat, met optionele parentId-refs
// die naar andere items in dezelfde payload wijzen via een tijdelijke `ref`).
const bulkItemsBody = z.object({
  items: z
    .array(
      z.object({
        ref: z.string().min(1).optional(), // tijdelijke client-ref voor nesting
        parentRef: z.string().min(1).nullable().optional(),
        label: z.string().trim().min(1).max(200),
        url: z.string().trim().min(1).max(1000),
        position: z.number().int().min(0).default(0),
      }),
    )
    .max(500),
});

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

void LOCATIONS; // conventie-set, niet hard afgedwongen

async function loadMenuScoped(id: string, shopId: string) {
  const [row] = await db
    .select()
    .from(cmsMenus)
    .where(and(eq(cmsMenus.id, id), eq(cmsMenus.shopId, shopId)))
    .limit(1);
  return row ?? null;
}

async function loadItems(menuId: string) {
  return db
    .select()
    .from(cmsMenuItems)
    .where(eq(cmsMenuItems.menuId, menuId))
    .orderBy(asc(cmsMenuItems.position), asc(cmsMenuItems.createdAt));
}

// ─── LIST menus ──────────────────────────────────────────────
menuRoutes.get('/', async (c) => {
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const { location } = parsed.data;

  const conds = [eq(cmsMenus.shopId, shopId)];
  if (location) conds.push(eq(cmsMenus.location, location));

  const rows = await db
    .select()
    .from(cmsMenus)
    .where(and(...conds))
    .orderBy(asc(cmsMenus.location), asc(cmsMenus.name));

  return c.json({ items: rows.map(toMenuDto) });
});

// ─── GET menu by id (incl. geneste items) ────────────────────
menuRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const menu = await loadMenuScoped(id, shopId);
  if (!menu) return c.json({ error: 'not_found' }, 404);
  const items = await loadItems(id);

  return c.json({
    menu: { ...toMenuDto(menu), items: nestMenuItems(items) },
  });
});

// ─── CREATE menu ─────────────────────────────────────────────
menuRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = createMenuBody.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const input = parsed.data;

  const shopRef = input.shopId ?? c.req.query('shop') ?? c.req.header('x-shop-id');
  const shopId = await resolveShopId(shopRef);
  if (!shopId) return shopError(c, !!shopRef);

  try {
    const menu = await runInTransactionWithAudit(async (tx, audit) => {
      const [row] = await tx
        .insert(cmsMenus)
        .values({ shopId, location: input.location, name: input.name })
        .returning();
      if (!row) throw new Error('cms_menu insert returned no row');
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'create',
        entityType: 'cms_menu',
        entityId: row.id,
        after: { id: row.id, shopId, location: row.location, name: row.name },
        ip: ip(c),
      });
      return row;
    });
    return c.json({ menu: { ...toMenuDto(menu), items: [] } }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json(
        { error: 'menu_conflict', message: 'Menu met deze locatie+naam bestaat al in deze shop.' },
        409,
      );
    }
    throw err;
  }
});

// ─── PATCH menu ──────────────────────────────────────────────
menuRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = patchMenuBody.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const input = parsed.data;

  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  try {
    const result = await runInTransactionWithAudit(async (tx, audit) => {
      const [existing] = await tx
        .select()
        .from(cmsMenus)
        .where(and(eq(cmsMenus.id, id), eq(cmsMenus.shopId, shopId)))
        .limit(1);
      if (!existing) return null;
      const patch: Partial<typeof cmsMenus.$inferInsert> = { updatedAt: new Date() };
      if (input.location !== undefined) patch.location = input.location;
      if (input.name !== undefined) patch.name = input.name;
      const [after] = await tx
        .update(cmsMenus)
        .set(patch)
        .where(eq(cmsMenus.id, id))
        .returning();
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'update',
        entityType: 'cms_menu',
        entityId: id,
        before: { location: existing.location, name: existing.name },
        after: after ? { location: after.location, name: after.name } : null,
        ip: ip(c),
      });
      return after ?? null;
    });
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json({ menu: toMenuDto(result) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: 'menu_conflict', message: 'Locatie+naam bestaat al in deze shop.' }, 409);
    }
    throw err;
  }
});

// ─── DELETE menu (cascade → items) ───────────────────────────
menuRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [existing] = await tx
      .select()
      .from(cmsMenus)
      .where(and(eq(cmsMenus.id, id), eq(cmsMenus.shopId, shopId)))
      .limit(1);
    if (!existing) return null;
    await tx.delete(cmsMenus).where(eq(cmsMenus.id, id)); // FK cascade verwijdert items
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'cms_menu',
      entityId: id,
      before: { location: existing.location, name: existing.name },
      ip: ip(c),
    });
    return existing;
  });
  if (!result) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

// ─── Menu-items ──────────────────────────────────────────────

// Helper: valideer dat parentId (indien gegeven) een item binnen dit menu is.
async function validateParent(
  tx: typeof db,
  menuId: string,
  parentId: string | null | undefined,
  selfId?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!parentId) return { ok: true };
  if (selfId && parentId === selfId) return { ok: false, reason: 'parent_is_self' };
  const [p] = await tx
    .select({ id: cmsMenuItems.id })
    .from(cmsMenuItems)
    .where(and(eq(cmsMenuItems.id, parentId), eq(cmsMenuItems.menuId, menuId)))
    .limit(1);
  if (!p) return { ok: false, reason: 'parent_not_in_menu' };
  return { ok: true };
}

// ─── CREATE item ─────────────────────────────────────────────
menuRoutes.post('/:id/items', async (c) => {
  const menuId = c.req.param('id');
  if (!isUuid(menuId)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = itemBody.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const input = parsed.data;

  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const menu = await loadMenuScoped(menuId, shopId);
  if (!menu) return c.json({ error: 'not_found' }, 404);

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const pv = await validateParent(tx as typeof db, menuId, input.parentId ?? null);
    if (!pv.ok) return { error: pv.reason };
    const [row] = await tx
      .insert(cmsMenuItems)
      .values({
        menuId,
        parentId: input.parentId ?? null,
        label: input.label,
        url: input.url,
        position: input.position,
      })
      .returning();
    if (!row) throw new Error('cms_menu_item insert returned no row');
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'cms_menu_item',
      entityId: row.id,
      after: { id: row.id, menuId, label: row.label, parentId: row.parentId },
      ip: ip(c),
    });
    return { item: row };
  });

  if ('error' in result) {
    return c.json({ error: 'invalid_parent', reason: result.error }, 400);
  }
  return c.json({ item: toMenuItemDto(result.item) }, 201);
});

// ─── PATCH item ──────────────────────────────────────────────
menuRoutes.patch('/:id/items/:itemId', async (c) => {
  const menuId = c.req.param('id');
  const itemId = c.req.param('itemId');
  if (!isUuid(menuId) || !isUuid(itemId)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = itemPatchBody.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const input = parsed.data;

  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const menu = await loadMenuScoped(menuId, shopId);
  if (!menu) return c.json({ error: 'not_found' }, 404);

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [existing] = await tx
      .select()
      .from(cmsMenuItems)
      .where(and(eq(cmsMenuItems.id, itemId), eq(cmsMenuItems.menuId, menuId)))
      .limit(1);
    if (!existing) return { notFound: true } as const;

    if (input.parentId !== undefined) {
      const pv = await validateParent(tx as typeof db, menuId, input.parentId, itemId);
      if (!pv.ok) return { error: pv.reason } as const;
    }

    const patch: Partial<typeof cmsMenuItems.$inferInsert> = {};
    if (input.parentId !== undefined) patch.parentId = input.parentId;
    if (input.label !== undefined) patch.label = input.label;
    if (input.url !== undefined) patch.url = input.url;
    if (input.position !== undefined) patch.position = input.position;

    const [after] = await tx
      .update(cmsMenuItems)
      .set(patch)
      .where(eq(cmsMenuItems.id, itemId))
      .returning();
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'cms_menu_item',
      entityId: itemId,
      before: { label: existing.label, parentId: existing.parentId, position: existing.position },
      after: after
        ? { label: after.label, parentId: after.parentId, position: after.position }
        : null,
      ip: ip(c),
    });
    return { item: after ?? null } as const;
  });

  if ('notFound' in result) return c.json({ error: 'not_found' }, 404);
  if ('error' in result) return c.json({ error: 'invalid_parent', reason: result.error }, 400);
  if (!result.item) return c.json({ error: 'not_found' }, 404);
  return c.json({ item: toMenuItemDto(result.item) });
});

// ─── DELETE item ─────────────────────────────────────────────
menuRoutes.delete('/:id/items/:itemId', async (c) => {
  const menuId = c.req.param('id');
  const itemId = c.req.param('itemId');
  if (!isUuid(menuId) || !isUuid(itemId)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const menu = await loadMenuScoped(menuId, shopId);
  if (!menu) return c.json({ error: 'not_found' }, 404);

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [existing] = await tx
      .select()
      .from(cmsMenuItems)
      .where(and(eq(cmsMenuItems.id, itemId), eq(cmsMenuItems.menuId, menuId)))
      .limit(1);
    if (!existing) return null;
    // Children worden door FK `set null` losgekoppeld (worden roots).
    await tx.delete(cmsMenuItems).where(eq(cmsMenuItems.id, itemId));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'cms_menu_item',
      entityId: itemId,
      before: { label: existing.label, menuId },
      ip: ip(c),
    });
    return existing;
  });
  if (!result) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

// ─── PUT items (bulk-replace = reorder/restructure heel menu) ──
//
// Vervangt ALLE items van een menu door de nieuwe set. Nesting wordt
// uitgedrukt via tijdelijke `ref`/`parentRef`-strings in de payload; de server
// mapt die naar echte uuid's na insert. Respecteert volgorde via `position`.
menuRoutes.put('/:id/items', async (c) => {
  const menuId = c.req.param('id');
  if (!isUuid(menuId)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = bulkItemsBody.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error.flatten());

  const { shopId, provided } = await resolveShopFromRequest(c);
  if (!shopId) return shopError(c, provided);

  const menu = await loadMenuScoped(menuId, shopId);
  if (!menu) return c.json({ error: 'not_found' }, 404);

  const incoming = parsed.data.items;
  // Validatie: parentRef moet naar een bekende ref in dezelfde payload wijzen.
  const refs = new Set(incoming.map((i) => i.ref).filter(Boolean) as string[]);
  for (const it of incoming) {
    if (it.parentRef && !refs.has(it.parentRef)) {
      return c.json(
        { error: 'invalid_parent_ref', reason: `parentRef '${it.parentRef}' niet gevonden in payload` },
        400,
      );
    }
  }

  const items = await runInTransactionWithAudit(async (tx, audit) => {
    // wipe bestaande items van dit menu
    await tx.delete(cmsMenuItems).where(eq(cmsMenuItems.menuId, menuId));

    // Insert in 2 passes: eerst roots+alles zonder parent, daarna kinderen.
    // Simpeler: insert alles parent-loos, onthoud ref→id, dan parents zetten.
    const refToId = new Map<string, string>();
    const insertedIds: string[] = [];
    for (const it of incoming) {
      const [row] = await tx
        .insert(cmsMenuItems)
        .values({
          menuId,
          parentId: null,
          label: it.label,
          url: it.url,
          position: it.position,
        })
        .returning();
      if (!row) throw new Error('bulk menu-item insert returned no row');
      insertedIds.push(row.id);
      if (it.ref) refToId.set(it.ref, row.id);
    }
    // pass 2: parent-refs naar echte id's mappen
    for (let i = 0; i < incoming.length; i++) {
      const it = incoming[i]!;
      if (it.parentRef) {
        const parentId = refToId.get(it.parentRef);
        if (parentId && parentId !== insertedIds[i]) {
          await tx
            .update(cmsMenuItems)
            .set({ parentId })
            .where(eq(cmsMenuItems.id, insertedIds[i]!));
        }
      }
    }
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'replace',
      entityType: 'cms_menu_items',
      entityId: menuId,
      after: { menuId, count: incoming.length },
      ip: ip(c),
    });

    return tx
      .select()
      .from(cmsMenuItems)
      .where(inArray(cmsMenuItems.id, insertedIds.length > 0 ? insertedIds : ['']))
      .orderBy(asc(cmsMenuItems.position), asc(cmsMenuItems.createdAt));
  });

  return c.json({ items: nestMenuItems(items) });
});
