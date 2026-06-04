/**
 * Admin-router — `/api/admin/*`.
 *
 * Platform-beheer: gebruikers, API-tokens, outbound webhooks. Eén top-level
 * `adminRoutes` Hono-app met drie ingebedde sub-routers (`.route(...)`), zelfde
 * patroon als de top-level aggregator. `requireAuth` op de wortel dekt alle
 * sub-routes.
 *
 * Sub-routes:
 *   /api/admin/users
 *     GET    /                  — list (paginate + search)
 *     POST   /                  — create (hashed password, hergebruik auth-lib)
 *     PATCH  /:id               — role/disable/password-reset
 *
 *   /api/admin/api-tokens
 *     GET    /                  — list (NOOIT raw token / hash)
 *     POST   /                  — create (geeft raw token 1x terug, slaat sha256-hash op)
 *     POST   /:id/revoke        — verwijder token
 *
 *   /api/admin/webhooks
 *     GET    /                  — list (filter scope/active/paginate)
 *     POST   /                  — create
 *     GET    /:id               — detail
 *     PATCH  /:id               — partial update
 *     DELETE /:id               — delete
 *
 * Writes lopen via `runInTransactionWithAudit` zodat `audit_log` meeschrijft.
 * SECURITY: password-hashes en token-hashes verlaten nooit de API; webhook-
 * secrets worden alleen als `hasSecret`-boolean geserialiseerd.
 *
 * Wired in routes/index.ts door finalizer (Atlas) — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { randomBytes, createHash } from 'node:crypto';
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { hashPassword } from '../../lib/auth.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { users } from '../../db/schema/users.js';
import { apiTokens } from '../../db/schema/api-tokens.js';
import { webhooks } from '../../db/schema/webhooks.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import {
  UserCreateSchema,
  UserUpdateSchema,
  UserListQuerySchema,
  ApiTokenCreateSchema,
  ApiTokenListQuerySchema,
  WebhookCreateSchema,
  WebhookUpdateSchema,
  WebhookListQuerySchema,
} from './_schemas.js';
import { toUserDto, toApiTokenDto, toWebhookDto } from './_serialize.js';

// ─── Users sub-router (/api/admin/users) ─────────────────────

const usersRoutes = new Hono<{ Variables: AuthVariables }>();

usersRoutes.get('/', async (c) => {
  const parsed = UserListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset, search } = parsed.data;

  const whereExpr = search ? ilike(users.email, `%${search}%`) : undefined;

  const rowsQuery = db
    .select()
    .from(users)
    .orderBy(asc(users.email))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: users.id }).from(users).where(whereExpr)
    : db.select({ id: users.id }).from(users));

  return c.json({
    items: rows.map(toUserDto),
    total: allIds.length,
    limit,
    offset,
  });
});

usersRoutes.post('/', async (c) => {
  const actor = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = UserCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const [clash] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (clash) {
    return c.json({ error: 'email_taken', field: 'email' }, 409);
  }

  const passwordHash = await hashPassword(input.password);

  const created = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        ...(input.role ? { role: input.role } : {}),
      })
      .returning();
    if (!row) throw new Error('user insert returned no row');

    audit.set({
      actor: { type: 'user', id: actor.id },
      action: 'create',
      entityType: 'user',
      entityId: row.id,
      before: null,
      after: { id: row.id, email: row.email, role: row.role },
      ip,
    });
    return row;
  });

  logger.info({ userId: created.id, email: created.email, actor: actor.id }, 'admin user created');
  return c.json({ user: toUserDto(created) }, 201);
});

usersRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const actor = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = UserUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!existing) {
    return c.json({ error: 'not_found' }, 404);
  }

  const setValues: Record<string, unknown> = {};
  // `disabled` convenience-flag wint van expliciete role alleen als role niet gezet is.
  if (patch.role !== undefined) {
    setValues.role = patch.role;
  } else if (patch.disabled !== undefined) {
    setValues.role = patch.disabled ? 'disabled' : 'admin';
  }
  if (patch.password !== undefined) {
    setValues.passwordHash = await hashPassword(patch.password);
  }

  if (Object.keys(setValues).length === 0) {
    return c.json({ error: 'no_effective_change' }, 400);
  }

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx.update(users).set(setValues).where(eq(users.id, id)).returning();
    if (!row) throw new Error('user update returned no row');

    audit.set({
      actor: { type: 'user', id: actor.id },
      action: 'update',
      entityType: 'user',
      entityId: row.id,
      // NB: password-changes verschijnen alleen als boolean-flag in audit, nooit de hash.
      before: { role: existing.role, passwordChanged: false },
      after: { role: row.role, passwordChanged: patch.password !== undefined },
      ip,
    });
    return row;
  });

  logger.info({ userId: id, actor: actor.id }, 'admin user updated');
  return c.json({ user: toUserDto(updated) });
});

// ─── API-tokens sub-router (/api/admin/api-tokens) ───────────

const apiTokensRoutes = new Hono<{ Variables: AuthVariables }>();

/** Raw token-format: `wsk_<43-char base64url>`. */
function generateRawToken(): string {
  return `wsk_${randomBytes(32).toString('base64url')}`;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

apiTokensRoutes.get('/', async (c) => {
  const parsed = ApiTokenListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset } = parsed.data;

  const rows = await db
    .select()
    .from(apiTokens)
    .orderBy(desc(apiTokens.createdAt))
    .limit(limit)
    .offset(offset);

  const allIds = await db.select({ id: apiTokens.id }).from(apiTokens);

  return c.json({
    items: rows.map(toApiTokenDto),
    total: allIds.length,
    limit,
    offset,
  });
});

apiTokensRoutes.post('/', async (c) => {
  const actor = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ApiTokenCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);

  const created = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .insert(apiTokens)
      .values({
        tokenHash,
        label: input.label,
        scope: input.scope,
      })
      .returning();
    if (!row) throw new Error('api_token insert returned no row');

    audit.set({
      actor: { type: 'user', id: actor.id },
      action: 'create',
      entityType: 'api_token',
      entityId: row.id,
      before: null,
      after: { id: row.id, label: row.label, scope: row.scope },
      ip,
    });
    return row;
  });

  logger.info({ tokenId: created.id, scope: created.scope, actor: actor.id }, 'api token created');
  // Raw token wordt hier 1x teruggegeven — nooit opnieuw op te halen.
  return c.json({ apiToken: toApiTokenDto(created), token: rawToken }, 201);
});

apiTokensRoutes.post('/:id/revoke', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const actor = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const [existing] = await db.select().from(apiTokens).where(eq(apiTokens.id, id)).limit(1);
  if (!existing) {
    return c.json({ error: 'not_found' }, 404);
  }

  await runInTransactionWithAudit(async (tx, audit) => {
    await tx.delete(apiTokens).where(eq(apiTokens.id, id));
    audit.set({
      actor: { type: 'user', id: actor.id },
      action: 'revoke',
      entityType: 'api_token',
      entityId: id,
      before: { id: existing.id, label: existing.label, scope: existing.scope },
      after: null,
      ip,
    });
  });

  logger.info({ tokenId: id, actor: actor.id }, 'api token revoked');
  return c.json({ ok: true, id });
});

// ─── Webhooks sub-router (/api/admin/webhooks) ───────────────

const webhooksRoutes = new Hono<{ Variables: AuthVariables }>();

webhooksRoutes.get('/', async (c) => {
  const parsed = WebhookListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset, scope, active } = parsed.data;

  const conditions = [];
  if (scope) conditions.push(eq(webhooks.scope, scope));
  if (active !== undefined) conditions.push(eq(webhooks.active, active));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(webhooks)
    .orderBy(desc(webhooks.createdAt))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: webhooks.id }).from(webhooks).where(whereExpr)
    : db.select({ id: webhooks.id }).from(webhooks));

  return c.json({
    items: rows.map(toWebhookDto),
    total: allIds.length,
    limit,
    offset,
  });
});

webhooksRoutes.post('/', async (c) => {
  const actor = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = WebhookCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const created = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .insert(webhooks)
      .values({
        event: input.event,
        url: input.url,
        scope: input.scope,
        shopId: input.shopId ?? null,
        secret: input.secret ?? null,
        ...(input.active !== undefined ? { active: input.active } : {}),
      })
      .returning();
    if (!row) throw new Error('webhook insert returned no row');

    audit.set({
      actor: { type: 'user', id: actor.id },
      action: 'create',
      entityType: 'webhook',
      entityId: row.id,
      before: null,
      after: { id: row.id, event: row.event, url: row.url, scope: row.scope },
      ip,
    });
    return row;
  });

  logger.info({ webhookId: created.id, event: created.event, actor: actor.id }, 'webhook created');
  return c.json({ webhook: toWebhookDto(created) }, 201);
});

webhooksRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const [webhook] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
  if (!webhook) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ webhook: toWebhookDto(webhook) });
});

webhooksRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const actor = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = WebhookUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
  if (!existing) {
    return c.json({ error: 'not_found' }, 404);
  }

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.event !== undefined) setValues.event = patch.event;
  if (patch.url !== undefined) setValues.url = patch.url;
  if (patch.scope !== undefined) setValues.scope = patch.scope;
  if (patch.shopId !== undefined) setValues.shopId = patch.shopId;
  if (patch.secret !== undefined) setValues.secret = patch.secret;
  if (patch.active !== undefined) setValues.active = patch.active;

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx.update(webhooks).set(setValues).where(eq(webhooks.id, id)).returning();
    if (!row) throw new Error('webhook update returned no row');

    audit.set({
      actor: { type: 'user', id: actor.id },
      action: 'update',
      entityType: 'webhook',
      entityId: row.id,
      before: { event: existing.event, url: existing.url, scope: existing.scope, active: existing.active },
      after: { event: row.event, url: row.url, scope: row.scope, active: row.active },
      ip,
    });
    return row;
  });

  logger.info({ webhookId: id, actor: actor.id }, 'webhook updated');
  return c.json({ webhook: toWebhookDto(updated) });
});

webhooksRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const actor = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
  if (!existing) {
    return c.json({ error: 'not_found' }, 404);
  }

  await runInTransactionWithAudit(async (tx, audit) => {
    await tx.delete(webhooks).where(eq(webhooks.id, id));
    audit.set({
      actor: { type: 'user', id: actor.id },
      action: 'delete',
      entityType: 'webhook',
      entityId: id,
      before: { id: existing.id, event: existing.event, url: existing.url },
      after: null,
      ip,
    });
  });

  logger.info({ webhookId: id, actor: actor.id }, 'webhook deleted');
  return c.json({ ok: true, id });
});

// ─── Top-level admin-app: embed de drie sub-routers ──────────

export const adminRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles — hele admin-module is afgeschermd.
adminRoutes.use('*', requireAuth);

adminRoutes.route('/users', usersRoutes);
adminRoutes.route('/api-tokens', apiTokensRoutes);
adminRoutes.route('/webhooks', webhooksRoutes);
