/**
 * Idempotency-Key middleware.
 *
 * Voor write-endpoints (POST/PUT/PATCH/DELETE):
 *   - Als request `Idempotency-Key`-header heeft EN we hebben een cached
 *     response: stuur die direct terug (zelfde status + body).
 *   - Anders: voer handler uit, sla response op met TTL 24u.
 *
 * Scope = route-pad zodat dezelfde key voor verschillende endpoints geen
 * collision geeft (`POST /api/products` vs `POST /api/orders`).
 */
import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { idempotencyKeys } from '../db/schema/idempotency-keys.js';
import { logger } from '../lib/logger.js';

const TTL_MS = 24 * 60 * 60 * 1000;
const HEADER = 'idempotency-key';

export const idempotency: MiddlewareHandler = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }
  const key = c.req.header(HEADER);
  if (!key) {
    return next();
  }

  const scope = `${method} ${c.req.path}`;
  const now = new Date();

  // Lookup
  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key))
    .limit(1);

  if (existing && existing.expiresAt.getTime() > now.getTime()) {
    if (existing.scope !== scope) {
      // Same key gebruikt voor andere endpoint = client-bug
      return c.json(
        { error: 'idempotency_key_scope_mismatch', expected: existing.scope, got: scope },
        409,
      );
    }
    logger.debug({ key, scope }, 'idempotency cache hit');
    return c.json(
      (existing.responseBody as unknown) ?? { ok: true },
      existing.responseStatus as 200,
    );
  }

  // Run handler — om response te kunnen cachen klonen we de Response na await next().
  await next();

  try {
    // Hono response is c.res. Body kan al gestreamed zijn — clone is veilig.
    const cloned = c.res.clone();
    const status = cloned.status;
    let body: unknown = null;
    const ct = cloned.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      try {
        body = await cloned.json();
      } catch {
        body = null;
      }
    }

    // 2xx + 4xx mogen gecached, 5xx niet (anders blijft een crash plakken).
    if (status < 500) {
      await db
        .insert(idempotencyKeys)
        .values({
          key,
          scope,
          responseStatus: status,
          responseBody: body as never,
          expiresAt: new Date(now.getTime() + TTL_MS),
        })
        .onConflictDoUpdate({
          target: idempotencyKeys.key,
          set: {
            scope,
            responseStatus: status,
            responseBody: body as never,
            expiresAt: new Date(now.getTime() + TTL_MS),
          },
        });
    }
  } catch (err) {
    logger.warn({ err, key, scope }, 'idempotency cache write failed (non-fatal)');
  }
};
