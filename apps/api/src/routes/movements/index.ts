/**
 * Movements-router — `/api/movements`.
 *
 * Read-only audit-trail van alle voorraadmutaties. Filters op item_id,
 * location_id, from_date, to_date, reason. Sort altijd `created_at desc`.
 *
 * Joint naar `inventory_items` voor SKU + naar `locations` voor name + naar
 * `users` voor actor-email.
 *
 * Multi-user: role 'user' ziet alleen movements van eigen producten
 * (via variants -> products.owner_user_id); admin ziet alles.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, gte, lte, count } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { inventoryItems } from '../../db/schema/inventory-items.js';
import { inventoryMovements } from '../../db/schema/inventory-movements.js';
import { locations } from '../../db/schema/locations.js';
import { users } from '../../db/schema/users.js';
import { variants } from '../../db/schema/variants.js';
import { products } from '../../db/schema/products.js';
import { isAdmin } from '../../lib/access.js';

export const movementsRoutes = new Hono<{ Variables: AuthVariables }>();

movementsRoutes.use('*', requireAuth);

const movementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  item_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
  reason: z.string().trim().min(1).max(64).optional(),
  from_date: z.string().datetime().optional(),
  to_date: z.string().datetime().optional(),
});

movementsRoutes.get('/', async (c) => {
  const parsed = movementsQuerySchema.safeParse({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
    item_id: c.req.query('item_id'),
    location_id: c.req.query('location_id'),
    reason: c.req.query('reason'),
    from_date: c.req.query('from_date'),
    to_date: c.req.query('to_date'),
  });
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { page, pageSize, item_id, location_id, reason, from_date, to_date } = parsed.data;
  const user = c.get('user');

  const whereParts = [];
  // Multi-user: non-admins zien alleen movements van voorraad die bij hun
  // eigen producten hoort (items -> variants -> products op owner_user_id).
  if (!isAdmin(user)) whereParts.push(eq(products.ownerUserId, user.id));
  if (item_id) whereParts.push(eq(inventoryMovements.itemId, item_id));
  if (location_id) whereParts.push(eq(inventoryMovements.locationId, location_id));
  if (reason) whereParts.push(eq(inventoryMovements.reason, reason));
  if (from_date) whereParts.push(gte(inventoryMovements.createdAt, new Date(from_date)));
  if (to_date) whereParts.push(lte(inventoryMovements.createdAt, new Date(to_date)));
  const whereExpr = whereParts.length > 0 ? and(...whereParts) : undefined;

  let baseSelect = db
    .select({
      id: inventoryMovements.id,
      itemId: inventoryMovements.itemId,
      locationId: inventoryMovements.locationId,
      delta: inventoryMovements.delta,
      reason: inventoryMovements.reason,
      refType: inventoryMovements.refType,
      refId: inventoryMovements.refId,
      actorId: inventoryMovements.actorId,
      note: inventoryMovements.note,
      createdAt: inventoryMovements.createdAt,
      itemSku: inventoryItems.sku,
      locationCode: locations.code,
      locationName: locations.name,
      actorEmail: users.email,
    })
    .from(inventoryMovements)
    .leftJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.itemId))
    .leftJoin(locations, eq(locations.id, inventoryMovements.locationId))
    .leftJoin(users, eq(users.id, inventoryMovements.actorId))
    .$dynamic();

  // Extra joins richting products zijn alleen nodig voor de owner-scoping.
  if (!isAdmin(user)) {
    baseSelect = baseSelect
      .leftJoin(variants, eq(variants.id, inventoryItems.variantId))
      .leftJoin(products, eq(products.id, variants.productId));
  }

  const rows = await (whereExpr ? baseSelect.where(whereExpr) : baseSelect)
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  let totalQuery = db
    .select({ total: count(inventoryMovements.id) })
    .from(inventoryMovements)
    .$dynamic();
  if (!isAdmin(user)) {
    totalQuery = totalQuery
      .leftJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.itemId))
      .leftJoin(variants, eq(variants.id, inventoryItems.variantId))
      .leftJoin(products, eq(products.id, variants.productId));
  }
  const totalRow = await (whereExpr ? totalQuery.where(whereExpr) : totalQuery);
  const total = totalRow[0]?.total ?? 0;

  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      itemSku: r.itemSku,
      location: {
        id: r.locationId,
        code: r.locationCode,
        name: r.locationName,
      },
      delta: r.delta,
      reason: r.reason,
      refType: r.refType,
      refId: r.refId,
      actor: r.actorId
        ? {
            id: r.actorId,
            email: r.actorEmail,
          }
        : null,
      note: r.note,
      createdAt: r.createdAt,
    })),
    page,
    pageSize,
    total: Number(total),
  });
});
