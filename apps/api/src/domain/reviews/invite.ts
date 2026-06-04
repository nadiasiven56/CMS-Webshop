/**
 * Public review-invitation service — `requestReviewInvitation(...)`.
 *
 * This is the ONE function other domains (orders, the order-delivered event)
 * call to queue a review-invitation after an order. It lives under `domain/`
 * (not `routes/`) precisely so those modules can import it WITHOUT a route
 * dependency:
 *
 *   import { requestReviewInvitation } from '../reviews/invite.js';
 *   await requestReviewInvitation({
 *     email: order.email,
 *     orderId: order.id,
 *     name: customerName,
 *   });
 *
 * KOPPEL-KLAAR / NEVER-THROW CONTRACT (mirrors notifications `sendNotification`):
 *   - This function NEVER throws to its caller. Callers (orders) must never break
 *     because no review-provider is connected yet. Every path writes exactly one
 *     `review_invitations` row and returns `{ status, invitationId }`.
 *   - If there is no active connected review-source → log `skipped_not_connected`
 *     and return (no send attempted). This is the key connect-ready behavior.
 *   - On a live send: provider accepted → `sent`; adapter error → `error`.
 *
 * The real provider call is guarded inside each adapter's `requireCreds()`, so
 * nothing live fires until the operator enters keys and connects a source.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import {
  reviewSources,
  reviewInvitations,
  type ReviewSource,
} from '../../db/schema/reviews.js';
import {
  getReviewAdapter,
  isReviewSourceNotConnectedError,
} from '../../routes/reviews/adapters/index.js';

export interface RequestReviewInvitationOptions {
  /** Recipient email address. */
  email: string;
  /** Optional CRM order id to correlate the invitation with. */
  orderId?: string;
  /** Optional customer display name passed to the provider. */
  name?: string;
}

export interface RequestReviewInvitationResult {
  /** 'sent' | 'error' | 'skipped_not_connected' */
  status: string;
  /** Id of the written review_invitations row. */
  invitationId: string;
}

/** Load the first active, connected review-source (if any). */
async function loadActiveSource(): Promise<ReviewSource | null> {
  const [row] = await db
    .select()
    .from(reviewSources)
    .where(eq(reviewSources.status, 'connected'))
    .orderBy(asc(reviewSources.createdAt))
    .limit(1);
  return row ?? null;
}

/** Append one review_invitations row and return its id. */
async function writeLog(entry: {
  sourceId: string | null;
  orderId: string | null;
  email: string;
  status: string;
  provider: string | null;
  error: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(reviewInvitations)
    .values({
      sourceId: entry.sourceId,
      orderId: entry.orderId,
      email: entry.email,
      status: entry.status,
      provider: entry.provider,
      error: entry.error,
    })
    .returning({ id: reviewInvitations.id });
  return row?.id ?? '';
}

/**
 * Request a review-invitation. NEVER throws — always logs + returns a status.
 * See the module docstring for the full connect-ready contract.
 */
export async function requestReviewInvitation(
  opts: RequestReviewInvitationOptions,
): Promise<RequestReviewInvitationResult> {
  const orderId = opts.orderId ?? null;

  // 1) No active+connected review-source → skip (connect-ready behavior).
  const source = await loadActiveSource();
  if (!source) {
    const invitationId = await writeLog({
      sourceId: null,
      orderId,
      email: opts.email,
      status: 'skipped_not_connected',
      provider: null,
      error: 'no active connected review source',
    });
    logger.info(
      { email: opts.email, orderId },
      'requestReviewInvitation skipped — no connected source',
    );
    return { status: 'skipped_not_connected', invitationId };
  }

  // 2) Resolve adapter. Unknown provider → log error, no throw.
  const adapter = getReviewAdapter(source.provider);
  if (!adapter) {
    const invitationId = await writeLog({
      sourceId: source.id,
      orderId,
      email: opts.email,
      status: 'error',
      provider: source.provider,
      error: `unsupported review provider '${source.provider}'`,
    });
    return { status: 'error', invitationId };
  }

  // 3) Send, guarded. The adapter's requireCreds throws not-connected when keys
  //    are missing; we treat that as skipped (connect-ready), never break.
  try {
    const result = await adapter.sendInvitation(source, {
      email: opts.email,
      orderRef: orderId,
      name: opts.name ?? null,
    });
    const invitationId = await writeLog({
      sourceId: source.id,
      orderId,
      email: opts.email,
      status: 'sent',
      provider: source.provider,
      error: null,
    });
    logger.info(
      {
        email: opts.email,
        orderId,
        provider: source.provider,
        externalId: result.externalId ?? null,
      },
      'requestReviewInvitation sent',
    );
    return { status: 'sent', invitationId };
  } catch (err) {
    const skipped = isReviewSourceNotConnectedError(err);
    const status = skipped ? 'skipped_not_connected' : 'error';
    const message = err instanceof Error ? err.message : 'invitation failed';
    const invitationId = await writeLog({
      sourceId: source.id,
      orderId,
      email: opts.email,
      status,
      provider: source.provider,
      error: message,
    });
    logger.warn(
      { email: opts.email, orderId, provider: source.provider, err: message },
      `requestReviewInvitation ${status}`,
    );
    return { status, invitationId };
  }
}
