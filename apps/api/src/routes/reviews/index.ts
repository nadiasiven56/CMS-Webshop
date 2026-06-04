/**
 * Reviews-router — `/api/reviews/*`.
 *
 * Review-provider-beheer (CONNECT-READY): pluggable review-provider
 * (kiyoh/trustpilot/google) + opgehaalde reviews + append-only invitation-log.
 * De route-laag praat NOOIT direct met een provider-API — altijd via een
 * {@link ReviewAdapter} uit de adapter-registry. De daadwerkelijke
 * review-uitnodiging (vanuit het order-delivered event) loopt via de publieke
 * service `requestReviewInvitation(...)` in `domain/reviews/invite.ts`.
 *
 * Endpoints (alle achter `requireAuth`):
 *   GET    /api/reviews/sources                       — list (masked creds + rating)
 *   POST   /api/reviews/sources                       — create {provider,name,config}
 *   GET    /api/reviews/sources/:id                   — detail
 *   PATCH  /api/reviews/sources/:id                   — partial update
 *   DELETE /api/reviews/sources/:id                   — delete (cascade reviews)
 *   PUT    /api/reviews/sources/:id/credentials       — encrypt → store
 *   POST   /api/reviews/sources/:id/test-connection   — verify → persist status
 *   POST   /api/reviews/sources/:id/fetch             — fetchReviews → upsert + summary
 *   GET    /api/reviews/sources/:id/reviews?limit=&offset= — stored reviews
 *   GET    /api/reviews/summary?source_id=            — average + count + distribution
 *   POST   /api/reviews/invite                        — {email,orderId?} → invitation
 *
 * KRITISCH: credentials worden encrypted opgeslagen (channel-crypto) en NOOIT
 * raw teruggegeven (alleen masked presence-map via _serialize).
 *
 * Wired in routes/index.ts door de orchestrator — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { encryptCredentials } from '../../lib/channel-crypto.js';
import {
  reviewSources,
  reviews as reviewsTable,
} from '../../db/schema/reviews.js';
import {
  getReviewAdapter,
  isReviewSourceNotConnectedError,
} from './adapters/index.js';
import type { NormalizedReview } from './adapters/types.js';
import { requestReviewInvitation } from '../../domain/reviews/invite.js';
import {
  CREDENTIALS_SCHEMA_BY_PROVIDER,
  InviteSchema,
  ReviewListQuerySchema,
  SourceCreateSchema,
  SourceListQuerySchema,
  SourcePatchSchema,
  SummaryQuerySchema,
} from './_schemas.js';
import { toSourceDto, toReviewDto } from './_serialize.js';

export const reviewRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles — admin-module.
reviewRoutes.use('*', requireAuth);

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

/** Format a numeric average to a numeric(3,2)-compatible string (or null). */
function toRatingString(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  // Clamp to the column's 3,2 range (max 9.99) and keep 2 decimals.
  const clamped = Math.min(Math.max(value, 0), 9.99);
  return clamped.toFixed(2);
}

// ════════════════════════════════════════════════════════════
// Sources
// ════════════════════════════════════════════════════════════

// ─── GET /sources — list ─────────────────────────────────────

reviewRoutes.get('/sources', async (c) => {
  const parsed = SourceListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { provider, status, limit, offset } = parsed.data;

  const conditions = [];
  if (provider) conditions.push(eq(reviewSources.provider, provider));
  if (status) conditions.push(eq(reviewSources.status, status));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(reviewSources)
    .orderBy(asc(reviewSources.name))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: reviewSources.id }).from(reviewSources).where(whereExpr)
    : db.select({ id: reviewSources.id }).from(reviewSources));

  return c.json({
    items: rows.map(toSourceDto),
    total: allIds.length,
    limit,
    offset,
  });
});

// ─── POST /sources — create ──────────────────────────────────

reviewRoutes.post('/sources', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = SourceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const source = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .insert(reviewSources)
      .values({
        provider: input.provider,
        name: input.name,
        status: 'disconnected',
        config: input.config ?? {},
      })
      .returning();
    if (!row) throw new Error('review_source insert returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'review_source',
      entityId: row.id,
      before: null,
      after: { id: row.id, provider: row.provider, name: row.name, status: row.status },
      ip: ip(c),
    });
    return row;
  });

  logger.info(
    { sourceId: source.id, provider: source.provider, actor: user.id },
    'review source created',
  );
  return c.json({ source: toSourceDto(source) }, 201);
});

// ─── GET /sources/:id — detail ───────────────────────────────

reviewRoutes.get('/sources/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [source] = await db
    .select()
    .from(reviewSources)
    .where(eq(reviewSources.id, id))
    .limit(1);
  if (!source) return c.json({ error: 'not_found' }, 404);

  return c.json({ source: toSourceDto(source) });
});

// ─── PATCH /sources/:id — update ─────────────────────────────

reviewRoutes.patch('/sources/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = SourcePatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;

  const [existing] = await db
    .select()
    .from(reviewSources)
    .where(eq(reviewSources.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) setValues.name = patch.name;
  if (patch.config !== undefined) setValues.config = patch.config;
  if (patch.status !== undefined) setValues.status = patch.status;

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(reviewSources)
      .set(setValues)
      .where(eq(reviewSources.id, id))
      .returning();
    if (!row) throw new Error('review_source update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'review_source',
      entityId: row.id,
      before: { name: existing.name, status: existing.status, config: existing.config },
      after: { name: row.name, status: row.status, config: row.config },
      ip: ip(c),
    });
    return row;
  });

  logger.info({ sourceId: id, actor: user.id }, 'review source updated');
  return c.json({ source: toSourceDto(updated) });
});

// ─── DELETE /sources/:id — cascade reviews ───────────────────

reviewRoutes.delete('/sources/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [existing] = await db
    .select()
    .from(reviewSources)
    .where(eq(reviewSources.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  await runInTransactionWithAudit(async (tx, audit) => {
    // reviews cascaden via FK onDelete:'cascade'; review_invitations.source_id
    // wordt op null gezet (onDelete:'set null') zodat de log behouden blijft.
    await tx.delete(reviewSources).where(eq(reviewSources.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'review_source',
      entityId: id,
      before: { id: existing.id, provider: existing.provider, name: existing.name },
      after: null,
      ip: ip(c),
    });
  });

  logger.info({ sourceId: id, actor: user.id }, 'review source deleted');
  return c.json({ ok: true, id });
});

// ─── PUT /sources/:id/credentials — encrypt + store ──────────

reviewRoutes.put('/sources/:id/credentials', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [existing] = await db
    .select()
    .from(reviewSources)
    .where(eq(reviewSources.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const schema =
    CREDENTIALS_SCHEMA_BY_PROVIDER[
      existing.provider as keyof typeof CREDENTIALS_SCHEMA_BY_PROVIDER
    ];
  if (schema === undefined) {
    return c.json({ error: 'unsupported_provider', provider: existing.provider }, 422);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }

  const encrypted = encryptCredentials(parsed.data as Record<string, unknown>);

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(reviewSources)
      .set({ credentials: encrypted, updatedAt: new Date() })
      .where(eq(reviewSources.id, id))
      .returning();
    if (!row) throw new Error('review_source credentials update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'review_source',
      entityId: row.id,
      // NOOIT de raw creds in audit — alleen dat ze gezet zijn.
      before: { hadCredentials: existing.credentials != null },
      after: { hasCredentials: true, fields: Object.keys(parsed.data as object) },
      ip: ip(c),
    });
    return row;
  });

  logger.info({ sourceId: id, actor: user.id }, 'review source credentials stored');
  return c.json({ source: toSourceDto(updated) });
});

// ─── POST /sources/:id/test-connection ───────────────────────

reviewRoutes.post('/sources/:id/test-connection', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [source] = await db
    .select()
    .from(reviewSources)
    .where(eq(reviewSources.id, id))
    .limit(1);
  if (!source) return c.json({ error: 'not_found' }, 404);

  const adapter = getReviewAdapter(source.provider);
  if (!adapter) {
    return c.json({ error: 'unsupported_provider', provider: source.provider }, 422);
  }

  // verifyConnection decrypteert in-memory (binnen de adapter) en throwt NOOIT.
  const verify = await adapter.verifyConnection(source);
  const nextStatus = verify.ok ? 'connected' : 'error';

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(reviewSources)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(reviewSources.id, id))
      .returning();
    if (!row) throw new Error('review_source status update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'review_source',
      entityId: row.id,
      before: { status: source.status },
      after: { status: row.status, verifyDetail: verify.detail },
      ip: ip(c),
    });
    return row;
  });

  return c.json({
    ok: verify.ok,
    detail: verify.detail,
    source: toSourceDto(updated),
  });
});

// ─── POST /sources/:id/fetch — fetchReviews → upsert + summary ─
//
// Guarded: als de source niet connected is geeft de adapter een typed
// review_source_not_connected (409) terug; niets vuurt zonder creds. Bij succes
// upserten we idempotent op (source_id, external_id) en updaten we de
// rating-samenvatting + lastFetchAt.

reviewRoutes.post('/sources/:id/fetch', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [source] = await db
    .select()
    .from(reviewSources)
    .where(eq(reviewSources.id, id))
    .limit(1);
  if (!source) return c.json({ error: 'not_found' }, 404);

  const adapter = getReviewAdapter(source.provider);
  if (!adapter) {
    return c.json({ error: 'unsupported_provider', provider: source.provider }, 422);
  }

  let result: Awaited<ReturnType<typeof adapter.fetchReviews>>;
  try {
    result = await adapter.fetchReviews(source);
  } catch (err) {
    if (isReviewSourceNotConnectedError(err)) {
      return c.json(
        {
          error: 'review_source_not_connected',
          message: err instanceof Error ? err.message : 'not connected',
        },
        409,
      );
    }
    return c.json(
      { error: 'fetch_failed', message: err instanceof Error ? err.message : 'failed' },
      502,
    );
  }

  // Idempotente upsert per review op (source_id, external_id).
  let upserted = 0;
  const errors: string[] = [];
  for (const review of result.reviews) {
    if (!review.externalId) continue;
    try {
      await upsertReview(source.id, source.provider, review);
      upserted += 1;
    } catch (err) {
      errors.push(
        `review ${review.externalId}: ${err instanceof Error ? err.message : 'upsert failed'}`,
      );
    }
  }

  const ratingAverage = toRatingString(result.average);
  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(reviewSources)
      .set({
        ratingAverage,
        ratingCount: result.count,
        lastFetchAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reviewSources.id, id))
      .returning();
    if (!row) throw new Error('review_source summary update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'fetch',
      entityType: 'review_source',
      entityId: row.id,
      after: { ratingAverage, ratingCount: result.count, upserted, errors: errors.length },
      ip: ip(c),
    });
    return row;
  });

  logger.info(
    { sourceId: id, upserted, ratingCount: result.count, errors: errors.length, actor: user.id },
    'review source fetched',
  );
  return c.json({
    upserted,
    ratingAverage,
    ratingCount: result.count,
    errors,
    source: toSourceDto(updated),
  });
});

// ─── GET /sources/:id/reviews — stored reviews ───────────────

reviewRoutes.get('/sources/:id/reviews', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const parsed = ReviewListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset } = parsed.data;

  const [source] = await db
    .select({ id: reviewSources.id })
    .from(reviewSources)
    .where(eq(reviewSources.id, id))
    .limit(1);
  if (!source) return c.json({ error: 'source_not_found' }, 404);

  const rows = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.sourceId, id))
    .orderBy(desc(reviewsTable.publishedAt))
    .limit(limit)
    .offset(offset);

  const allIds = await db
    .select({ id: reviewsTable.id })
    .from(reviewsTable)
    .where(eq(reviewsTable.sourceId, id));

  return c.json({
    sourceId: id,
    items: rows.map(toReviewDto),
    total: allIds.length,
    limit,
    offset,
  });
});

// ─── GET /summary — average + count + distribution ───────────
//
// Aggregeert de OPGESLAGEN reviews (de stored trust-signal) — optioneel per
// source. Distribution = aantal reviews per ster (1..5).

reviewRoutes.get('/summary', async (c) => {
  const parsed = SummaryQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { source_id } = parsed.data;

  const whereExpr = source_id ? eq(reviewsTable.sourceId, source_id) : undefined;
  const rowsQuery = db
    .select({ rating: reviewsTable.rating })
    .from(reviewsTable)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const distribution: Record<string, number> = {
    '1': 0,
    '2': 0,
    '3': 0,
    '4': 0,
    '5': 0,
  };
  let sum = 0;
  let rated = 0;
  for (const r of rows) {
    if (r.rating == null) continue;
    const key = String(Math.min(Math.max(r.rating, 1), 5));
    distribution[key] = (distribution[key] ?? 0) + 1;
    sum += r.rating;
    rated += 1;
  }
  const average = rated > 0 ? Number((sum / rated).toFixed(2)) : null;

  return c.json({
    sourceId: source_id ?? null,
    count: rows.length,
    rated,
    average,
    distribution,
  });
});

// ════════════════════════════════════════════════════════════
// Invite
// ════════════════════════════════════════════════════════════

// ─── POST /invite ────────────────────────────────────────────
//
// Queue een review-invitation via de publieke requestReviewInvitation-service.
// Als er geen actieve connected source is → status 'skipped_not_connected' met
// een duidelijke message (NOOIT een 500 — dit is het koppel-klaar-gedrag).

reviewRoutes.post('/invite', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { email, orderId, name } = parsed.data;

  const result = await requestReviewInvitation({ email, orderId, name });

  const message =
    result.status === 'skipped_not_connected'
      ? 'Geen actieve, verbonden review-provider — er is geen uitnodiging verstuurd. Koppel eerst een provider.'
      : result.status === 'sent'
        ? 'Review-uitnodiging verstuurd.'
        : 'Review-uitnodiging kon niet worden verstuurd — zie de invitation-log voor details.';

  logger.info(
    { email, orderId, status: result.status, actor: user.id },
    'review invite requested',
  );
  return c.json({
    status: result.status,
    invitationId: result.invitationId,
    message,
  });
});

// ─── helpers (idempotent upsert) ─────────────────────────────

/**
 * Idempotente upsert op reviews, geleund op de UNIQUE (source_id, external_id).
 * Bij conflict updaten we de muteerbare velden + raw.
 */
async function upsertReview(
  sourceId: string,
  provider: string,
  review: NormalizedReview,
): Promise<void> {
  await db
    .insert(reviewsTable)
    .values({
      sourceId,
      externalId: review.externalId,
      provider,
      rating: review.rating,
      title: review.title,
      body: review.body,
      authorName: review.authorName,
      publishedAt: review.publishedAt ? new Date(review.publishedAt) : null,
      raw: review.raw,
    })
    .onConflictDoUpdate({
      target: [reviewsTable.sourceId, reviewsTable.externalId],
      set: {
        rating: review.rating,
        title: review.title,
        body: review.body,
        authorName: review.authorName,
        publishedAt: review.publishedAt ? new Date(review.publishedAt) : null,
        raw: review.raw,
        updatedAt: new Date(),
      },
    });
}
