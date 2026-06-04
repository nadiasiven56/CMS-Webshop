/**
 * GoogleAdapter — CONNECT-READY adapter for Google Business Profile reviews
 * (read-only).
 *
 * Google Business Profile exposes reviews via the My Business / Business Profile
 * APIs but offers NO review-invitation API. So:
 *   - `sendInvitation` returns a `not_supported` raw note WITHOUT throwing-to-
 *     break the never-throw invite contract (Google simply can't invite). It is
 *     still guarded by `requireCreds()` so it does not pretend to be connected.
 *   - `fetchReviews` IS guarded behind `requireCreds()` like the other adapters;
 *     nothing live fires without an access token + account/location ids.
 *
 * Credentials shape (stored encrypted, decrypted in-memory by the adapter):
 *   { accessToken: string }
 * Config (plain jsonb on the source):
 *   { accountId: string, locationId: string }
 *
 * Auth: a pre-obtained OAuth2 Bearer access token (the operator supplies it; the
 * orchestrator can later swap in a refresh-token flow). Resource calls target
 * `https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews`.
 */
import type { ReviewSource } from '../../../db/schema/reviews.js';
import { decryptCredentials } from '../../../lib/channel-crypto.js';
import {
  ReviewSourceNotConnectedError,
  normalizeDate,
  normalizeRating,
  type FetchReviewsResult,
  type InvitationInput,
  type NormalizedReview,
  type ReviewAdapter,
  type SendInvitationResult,
  type VerifyResult,
} from './types.js';

/** Google My Business v4 reviews base. */
const GOOGLE_MYBUSINESS_BASE = 'https://mybusiness.googleapis.com/v4/';

/** Map Google's enum star rating to a 1..5 integer. */
const STAR_ENUM: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

interface GoogleContext {
  accessToken: string;
  accountId: string;
  locationId: string;
  sourceId: string;
}

export class GoogleAdapter implements ReviewAdapter {
  readonly provider = 'google';

  // ─── Credential resolution ─────────────────────────────────

  private requireCreds(source: ReviewSource): GoogleContext {
    if (source.status !== 'connected') {
      throw new ReviewSourceNotConnectedError('Google credentials required');
    }
    const creds = decryptCredentials(
      (source.credentials ?? null) as { enc: string } | null,
    );
    const accessToken =
      creds && typeof creds.accessToken === 'string' ? creds.accessToken : '';
    if (!accessToken) {
      throw new ReviewSourceNotConnectedError('Google credentials required');
    }
    const cfg = (source.config ?? {}) as {
      accountId?: unknown;
      locationId?: unknown;
    };
    return {
      accessToken,
      accountId: typeof cfg.accountId === 'string' ? cfg.accountId : '',
      locationId: typeof cfg.locationId === 'string' ? cfg.locationId : '',
      sourceId: source.id,
    };
  }

  // ─── Connection check (never throws) ───────────────────────

  async verifyConnection(source: ReviewSource): Promise<VerifyResult> {
    let ctx: GoogleContext;
    try {
      ctx = this.requireCreds(source);
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Google credentials required',
      };
    }
    if (!ctx.accountId || !ctx.locationId) {
      return {
        ok: false,
        detail: 'Google accountId/locationId ontbreekt in config.',
      };
    }
    try {
      await this.fetchFeed(ctx);
      return {
        ok: true,
        detail: `Google Business Profile verbonden (location ${ctx.locationId}).`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'google connection failed',
      };
    }
  }

  // ─── Invitations (NOT SUPPORTED — never breaks) ────────────

  /**
   * Google Business Profile has no invitation API. We still run requireCreds so
   * we don't pretend to be connected, then return a `not_supported` raw note
   * (no externalId). The domain service treats a missing externalId + this note
   * as a graceful no-op; it never throws-to-break the order-delivered flow.
   */
  async sendInvitation(
    source: ReviewSource,
    _input: InvitationInput,
  ): Promise<SendInvitationResult> {
    this.requireCreds(source);
    return {
      raw: {
        not_supported: true,
        provider: this.provider,
        note: 'Google Business Profile biedt geen review-invitation API.',
      },
    };
  }

  // ─── Reviews feed ──────────────────────────────────────────

  async fetchReviews(source: ReviewSource): Promise<FetchReviewsResult> {
    const ctx = this.requireCreds(source);
    const feed = await this.fetchFeed(ctx);
    return this.normalizeFeed(feed);
  }

  // ─── Internals ─────────────────────────────────────────────

  private async fetchFeed(ctx: GoogleContext): Promise<Record<string, unknown>> {
    const path = `accounts/${encodeURIComponent(ctx.accountId)}/locations/${encodeURIComponent(
      ctx.locationId,
    )}/reviews`;
    return this.request<Record<string, unknown>>(path, ctx);
  }

  /** Map a raw Google reviews payload to the normalized summary + reviews. */
  normalizeFeed(feed: Record<string, unknown>): FetchReviewsResult {
    const rawReviews = Array.isArray(feed.reviews)
      ? (feed.reviews as Record<string, unknown>[])
      : [];
    const reviews: NormalizedReview[] = rawReviews.map((r) => {
      const reviewer = (r.reviewer ?? {}) as Record<string, unknown>;
      const starRating =
        typeof r.starRating === 'string' ? STAR_ENUM[r.starRating] ?? null : null;
      return {
        externalId: String(r.reviewId ?? r.name ?? ''),
        rating: starRating ?? normalizeRating(r.starRating),
        title: null, // Google reviews have no title
        body: typeof r.comment === 'string' ? r.comment : null,
        authorName:
          typeof reviewer.displayName === 'string' ? reviewer.displayName : null,
        publishedAt: normalizeDate(r.createTime ?? r.updateTime),
        raw: r,
      };
    });
    const average =
      feed.averageRating != null ? Number(feed.averageRating) : null;
    const count =
      typeof feed.totalReviewCount === 'number'
        ? feed.totalReviewCount
        : Number(feed.totalReviewCount ?? reviews.length) || reviews.length;
    return {
      average: average != null && Number.isFinite(average) ? average : null,
      count,
      reviews,
    };
  }

  /** Authenticated Google request relative to the My Business v4 base. */
  private async request<T = unknown>(
    path: string,
    ctx: GoogleContext,
  ): Promise<T> {
    const res = await fetch(`${GOOGLE_MYBUSINESS_BASE}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(
        `google request failed (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      );
    }
    const text = await safeReadText(res);
    if (!text) return undefined as unknown as T;
    return JSON.parse(text) as T;
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export const googleAdapter = new GoogleAdapter();
