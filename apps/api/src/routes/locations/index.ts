/**
 * Locations-router — `/api/locations/*`.
 *
 * Voorraadlocaties: warehouse | dropship | virtual | store | transit.
 * `code` is uniek (vriendelijke 409 bij clash). `priority` bepaalt
 * fulfillment-volgorde (lager = eerder).
 *
 * Endpoints (alle achter `requireAuth`):
 *   GET    /api/locations        — list (paginate + filter active/search)
 *   POST   /api/locations        — create
 *   GET    /api/locations/:id    — detail
 *   PATCH  /api/locations/:id    — partial update
 *   DELETE /api/locations/:id    — delete
 *
 * Writes lopen via `runInTransactionWithAudit` zodat `audit_log` meeschrijft.
 *
 * Wired in routes/index.ts door finalizer (Atlas) — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { locations } from '../../db/schema/locations.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import {
  LocationCreateSchema,
  LocationUpdateSchema,
  LocationListQuerySchema,
} from './_schemas.js';
import { toLocationDto } from './_serialize.js';

export const locationsRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles — admin-module.
locationsRoutes.use('*', requireAuth);

// ─── GET /api/locations — list ───────────────────────────────

locationsRoutes.get('/', async (c) => {
  const parsed = LocationListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset, active, search } = parsed.data;

  const conditions = [];
  if (active !== undefined) conditions.push(eq(locations.active, active));
  if (search) {
    const term = `%${search}%`;
    conditions.push(or(ilike(locations.name, term), ilike(locations.code, term)));
  }
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(locations)
    .orderBy(asc(locations.priority), asc(locations.name))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: locations.id }).from(locations).where(whereExpr)
    : db.select({ id: locations.id }).from(locations));
  const total = allIds.length;

  return c.json({
    items: rows.map(toLocationDto),
    total,
    limit,
    offset,
  });
});

// ─── POST /api/locations — create ────────────────────────────

locationsRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = LocationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  // Uniqueness pre-check op code (vriendelijke 409 i.p.v. raw constraint-error).
  const [codeClash] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.code, input.code))
    .limit(1);
  if (codeClash) {
    return c.json({ error: 'code_taken', field: 'code' }, 409);
  }

  try {
    const location = await runInTransactionWithAudit(async (tx, audit) => {
      const [row] = await tx
        .insert(locations)
        .values({
          code: input.code,
          name: input.name,
          ...(input.type ? { type: input.type } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          address: input.address ?? null,
          ...(input.active !== undefined ? { active: input.active } : {}),
        })
        .returning();
      if (!row) throw new Error('location insert returned no row');

      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'create',
        entityType: 'location',
        entityId: row.id,
        before: null,
        after: { id: row.id, code: row.code, name: row.name, type: row.type },
        ip,
      });
      return row;
    });

    logger.info({ locationId: location.id, code: location.code, actor: user.id }, 'location created');
    return c.json({ location: toLocationDto(location) }, 201);
  } catch (err) {
    logger.error({ err, code: input.code }, 'location create failed');
    throw err;
  }
});

// ─── GET /api/locations/:id — detail ─────────────────────────

locationsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const [location] = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  if (!location) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ location: toLocationDto(location) });
});

// ─── PATCH /api/locations/:id — update ───────────────────────

locationsRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = LocationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const [existing] = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  if (!existing) {
    return c.json({ error: 'not_found' }, 404);
  }

  // Uniqueness pre-check bij code-wissel.
  if (patch.code && patch.code !== existing.code) {
    const [clash] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.code, patch.code))
      .limit(1);
    if (clash) return c.json({ error: 'code_taken', field: 'code' }, 409);
  }

  // Bouw set-object alleen voor meegegeven velden (partial update).
  const setValues: Record<string, unknown> = {};
  if (patch.code !== undefined) setValues.code = patch.code;
  if (patch.name !== undefined) setValues.name = patch.name;
  if (patch.type !== undefined) setValues.type = patch.type;
  if (patch.priority !== undefined) setValues.priority = patch.priority;
  if (patch.address !== undefined) setValues.address = patch.address;
  if (patch.active !== undefined) setValues.active = patch.active;

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(locations)
      .set(setValues)
      .where(eq(locations.id, id))
      .returning();
    if (!row) throw new Error('location update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'location',
      entityId: row.id,
      before: {
        code: existing.code,
        name: existing.name,
        type: existing.type,
        priority: existing.priority,
        active: existing.active,
      },
      after: {
        code: row.code,
        name: row.name,
        type: row.type,
        priority: row.priority,
        active: row.active,
      },
      ip,
    });
    return row;
  });

  logger.info({ locationId: id, actor: user.id }, 'location updated');
  return c.json({ location: toLocationDto(updated) });
});

// ─── DELETE /api/locations/:id ───────────────────────────────

locationsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const [existing] = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  if (!existing) {
    return c.json({ error: 'not_found' }, 404);
  }

  await runInTransactionWithAudit(async (tx, audit) => {
    await tx.delete(locations).where(eq(locations.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'location',
      entityId: id,
      before: { id: existing.id, code: existing.code, name: existing.name },
      after: null,
      ip,
    });
  });

  logger.info({ locationId: id, actor: user.id }, 'location deleted');
  return c.json({ ok: true, id });
});
