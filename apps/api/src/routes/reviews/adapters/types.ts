/**
 * ReviewAdapter — uniform contract for every review-provider integration.
 *
 * The route-layer never talks to a provider SDK/HTTP API directly; it talks to a
 * `ReviewAdapter`. Each concrete adapter (kiyoh / trustpilot / google) maps the
 * provider's quirks to the CRM's normalized shapes below.
 *
 * CONNECT-READY conventions (mirror the channels module):
 *   - `verifyConnection` is the only method cheap + side-effect-free enough to
 *     call on demand from the UI ("test connection"). It NEVER throws — it turns
 *     the not-connected guard into a clean `{ok:false}`.
 *   - Every network-touching method (`sendInvitation`, `fetchReviews`) must guard
 *     behind a private `requireCreds()` check and surface a typed
 *     {@link ReviewSourceNotConnectedError} instead of firing a live request
 *     until the operator enters keys and the source is `status='connected'`.
 *   - Google has no invitation API; its `sendInvitation` returns a
 *     `not_supported` raw note WITHOUT throwing-to-break, but `fetchReviews`
 *     stays guarded by `requireCreds()` like the others.
 */
import type { ReviewSource } from '../../../db/schema/reviews.js';

/** A single normalized review as seen across providers. */
export interface NormalizedReview {
  /** Stable id at the source (review id at kiyoh/trustpilot/google). */
  externalId: string;
  /** Star rating normalized to a whole integer 1..5 (best-effort). */
  rating: number | null;
  /** Review title/headline if the provider exposes one. */
  title: string | null;
  /** Review body / free-text content. */
  body: string | null;
  /** Display name of the reviewer if exposed. */
  authorName: string | null;
  /** When the review was published at the source, ISO-8601, or null. */
  publishedAt: string | null;
  /** Original raw payload — stored verbatim in reviews.raw for audit/debug. */
  raw: Record<string, unknown>;
}

/** Result of `fetchReviews` — the rating summary + the normalized reviews. */
export interface FetchReviewsResult {
  /** Average star rating exposed by the provider, or null if unknown. */
  average: number | null;
  /** Total number of reviews the provider reports. */
  count: number;
  /** The normalized review rows to upsert. */
  reviews: NormalizedReview[];
}

/** Payload handed to `sendInvitation`. */
export interface InvitationInput {
  /** Recipient e-mail address. */
  email: string;
  /** Order reference / number to correlate the invitation at the provider. */
  orderRef?: string | null;
  /** Customer display name if available. */
  name?: string | null;
}

/** Result of `sendInvitation`. */
export interface SendInvitationResult {
  /** Provider-side invitation id once created (if the provider returns one). */
  externalId?: string;
  /** Original raw payload — kept for audit/debug. */
  raw: Record<string, unknown>;
}

/** Result of `verifyConnection`. */
export interface VerifyResult {
  ok: boolean;
  detail: string;
}

/**
 * Typed "not connected" signal. Adapters throw this from their `requireCreds()`
 * guard so the route-layer + domain service can translate it to a clean 409 /
 * skip without leaking which network call would have fired.
 */
export class ReviewSourceNotConnectedError extends Error {
  readonly error = 'review_source_not_connected' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ReviewSourceNotConnectedError';
  }
}

/** Type-guard for {@link ReviewSourceNotConnectedError} (works across realms). */
export function isReviewSourceNotConnectedError(
  e: unknown,
): e is ReviewSourceNotConnectedError {
  return (
    e instanceof ReviewSourceNotConnectedError ||
    (typeof e === 'object' &&
      e !== null &&
      (e as { error?: unknown }).error === 'review_source_not_connected')
  );
}

/**
 * Shared adapter contract. Every concrete adapter implements this surface; the
 * route-layer always goes through `getReviewAdapter()` so it never hard-codes a
 * specific provider API.
 */
export interface ReviewAdapter {
  /** Review provider this adapter handles: 'kiyoh' | 'trustpilot' | 'google'. */
  readonly provider: string;

  /** Cheap reachability/credentials check. Never throws — returns ok:false. */
  verifyConnection(source: ReviewSource): Promise<VerifyResult>;

  /**
   * Send a review-invitation for an order. Guarded behind requireCreds (except
   * Google, which returns a `not_supported` raw note without breaking).
   */
  sendInvitation(
    source: ReviewSource,
    input: InvitationInput,
  ): Promise<SendInvitationResult>;

  /** Pull the rating summary + recent reviews into normalized shape. */
  fetchReviews(source: ReviewSource): Promise<FetchReviewsResult>;
}

// ─── Shared credential/normalization helpers (pure) ──────────

/**
 * Coerce an arbitrary provider rating value to a whole 1..5 integer (or null).
 * Providers expose ratings on different scales (1..5 stars, 1..10, 0..100); we
 * keep it best-effort and clamp to 1..5 so the stored `reviews.rating` is sane.
 */
export function normalizeRating(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1) return 1;
  if (rounded > 5) return 5;
  return rounded;
}

/** Best-effort ISO-8601 string from an arbitrary provider date value. */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}
