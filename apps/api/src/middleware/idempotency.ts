/**
 * Idempotency-Key middleware.
 *
 * Voor write-endpoints (POST/PUT/PATCH/DELETE):
 *   - Als request `Idempotency-Key`-header heeft EN we hebben een GECACHTE
 *     (voltooide, 2xx) response: stuur die direct terug (zelfde status + body).
 *   - Anders: RESERVEER de key (in_progress), voer de handler uit en cache het
 *     resultaat (alleen 2xx) met TTL 24u.
 *
 * Concurrency-hardening: vóór de handler doen we een `INSERT … onConflictDoNothing`
 * met een `in_progress`-marker (sentinel-status 0). Zo kan slechts één van twee
 * gelijktijdige eerste requests met dezelfde key de reservatie winnen; de
 * verliezer krijgt óf de gecachte 2xx-response, óf 409 `idempotency_in_progress`
 * als de eerste nog loopt. Dit voorkomt dat dezelfde write twee keer draait.
 *
 * Backwards-compatible: alleen 2xx wordt gecached (4xx/5xx niet → een afgewezen
 * request blokkeert de key niet en mag opnieuw). De marker wordt na een
 * niet-2xx of een crash weer opgeruimd zodat de client kan retryen.
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

/** Sentinel-status voor een gereserveerde-maar-nog-niet-voltooide key. */
const IN_PROGRESS = 0;

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
  const expiresAt = new Date(now.getTime() + TTL_MS);

  // ─── 1. Lookup: bestaande (geldige) record? ─────────────────
  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key))
    .limit(1);

  if (existing && existing.expiresAt.getTime() > now.getTime()) {
    if (existing.scope !== scope) {
      // Same key gebruikt voor andere endpoint = client-bug.
      return c.json(
        { error: 'idempotency_key_scope_mismatch', expected: existing.scope, got: scope },
        409,
      );
    }
    if (existing.responseStatus === IN_PROGRESS) {
      // Een eerdere (gelijktijdige) request draait nog → vraag client te retryen.
      logger.debug({ key, scope }, 'idempotency in-progress');
      return c.json({ error: 'idempotency_in_progress' }, 409);
    }
    // Voltooide (2xx) response → direct terug.
    logger.debug({ key, scope }, 'idempotency cache hit');
    return c.json(
      (existing.responseBody as unknown) ?? { ok: true },
      existing.responseStatus as 200,
    );
  }

  // ─── 2. Reserveer de key (race-safe) ────────────────────────
  // INSERT … onConflictDoNothing: precies één gelijktijdige request wint.
  let reserved = false;
  try {
    const inserted = await db
      .insert(idempotencyKeys)
      .values({
        key,
        scope,
        responseStatus: IN_PROGRESS,
        responseBody: null,
        expiresAt,
      })
      .onConflictDoNothing({ target: idempotencyKeys.key })
      .returning({ key: idempotencyKeys.key });
    reserved = inserted.length > 0;
  } catch (err) {
    // Reservatie-fout mag de flow niet breken; draai dan gewoon de handler
    // (zonder idempotentie-garantie) i.p.v. de request te laten falen.
    logger.warn({ err, key, scope }, 'idempotency reserve failed (running handler unguarded)');
    return next();
  }

  if (!reserved) {
    // We verloren de race (of er stond een verlopen rij die niet door stap 1
    // gevangen werd). Herlees en gedraag je als stap 1.
    const [row] = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .limit(1);
    if (row && row.expiresAt.getTime() > now.getTime()) {
      if (row.scope !== scope) {
        return c.json(
          { error: 'idempotency_key_scope_mismatch', expected: row.scope, got: scope },
          409,
        );
      }
      if (row.responseStatus === IN_PROGRESS) {
        return c.json({ error: 'idempotency_in_progress' }, 409);
      }
      return c.json(
        (row.responseBody as unknown) ?? { ok: true },
        row.responseStatus as 200,
      );
    }
    // Verlopen rij blokkeerde de insert: overschrijf 'm met een verse reservatie.
    try {
      await db
        .update(idempotencyKeys)
        .set({ scope, responseStatus: IN_PROGRESS, responseBody: null, expiresAt })
        .where(eq(idempotencyKeys.key, key));
      reserved = true;
    } catch (err) {
      logger.warn({ err, key, scope }, 'idempotency re-reserve failed (running handler unguarded)');
      return next();
    }
  }

  // ─── 3. Run handler ─────────────────────────────────────────
  await next();

  // ─── 4. Cache (alleen 2xx) of geef de reservatie weer vrij ──
  try {
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

    if (status >= 200 && status < 300) {
      // Voltooid → cache de response over de in_progress-marker heen.
      await db
        .update(idempotencyKeys)
        .set({
          scope,
          responseStatus: status,
          responseBody: body as never,
          expiresAt: new Date(Date.now() + TTL_MS),
        })
        .where(eq(idempotencyKeys.key, key));
    } else {
      // Niet-2xx → geef de key vrij zodat de client legitiem mag retryen.
      // (We verwijderen alleen onze eigen nog-in-progress reservatie.)
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
    }
  } catch (err) {
    logger.warn({ err, key, scope }, 'idempotency cache write failed (non-fatal)');
    // Best-effort: probeer de marker op te ruimen zodat de key niet blijft hangen.
    try {
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
    } catch {
      /* geef het op — de TTL ruimt 'm uiteindelijk op */
    }
  }
};
