/**
 * KiyohAdapter — CONNECT-READY adapter for the Kiyoh review API.
 *
 * Implements the official Kiyoh contract (apiHash + locationId, base
 * `https://www.kiyoh.com/v1/`) but is READY UP TO THE KEY-ENTRY POINT: nothing
 * live ever fires without credentials. Every network-touching method first calls
 * the private `requireCreds()` guard, which throws a typed
 * {@link ReviewSourceNotConnectedError} ('Kiyoh credentials required') when the
 * source is not `status='connected'` or the apiHash is empty. Once the operator
 * wires a real apiHash + locationId and flips the source to connected, these
 * methods call the real endpoints.
 *
 * Credentials shape (stored encrypted, decrypted in-memory by the adapter):
 *   { apiHash: string }
 * Config (plain jsonb on the source):
 *   { locationId: string }
 *
 * Auth: Kiyoh authenticates via the per-account API hash, passed as a header
 * (`X-Publication-Api-Token`) plus the `locationId` query param. The review feed
 * returns the location's rating summary + the latest reviews; the invite
 * endpoint queues an invitation e-mail for a delivered order.
 *
 * Endpoints used:
 *   - GET  /v1/publication/review/external?locationId={id}   (feed + summary)
 *   - POST /v1/invitation                                     (queue invitation)
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

/** Official Kiyoh API base. */
const KIYOH_BASE_URL = 'https://www.kiyoh.com/v1/';

interface KiyohContext {
  apiHash: string;
  locationId: string;
  sourceId: string;
}

export class KiyohAdapter implements ReviewAdapter {
  readonly provider = 'kiyoh';

  // ─── Credential resolution ─────────────────────────────────

  /**
   * Guard: returns the decrypted apiHash + locationId only when the source is
   * connected and has a non-empty apiHash. Otherwise throws the typed
   * not-connected error so NO live request can fire.
   */
  private requireCreds(source: ReviewSource): KiyohContext {
    if (source.status !== 'connected') {
      throw new ReviewSourceNotConnectedError('Kiyoh credentials required');
    }
    const creds = decryptCredentials(
      (source.credentials ?? null) as { enc: string } | null,
    );
    const apiHash = creds && typeof creds.apiHash === 'string' ? creds.apiHash : '';
    if (!apiHash) {
      throw new ReviewSourceNotConnectedError('Kiyoh credentials required');
    }
    const cfg = (source.config ?? {}) as { locationId?: unknown };
    const locationId = typeof cfg.locationId === 'string' ? cfg.locationId : '';
    return { apiHash, locationId, sourceId: source.id };
  }

  // ─── Connection check (never throws) ───────────────────────

  async verifyConnection(source: ReviewSource): Promise<VerifyResult> {
    let ctx: KiyohContext;
    try {
      ctx = this.requireCreds(source);
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Kiyoh credentials required',
      };
    }
    if (!ctx.locationId) {
      return { ok: false, detail: 'Kiyoh locationId ontbreekt in config.' };
    }
    try {
      await this.fetchFeed(ctx);
      return { ok: true, detail: `Kiyoh verbonden (location ${ctx.locationId}).` };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'kiyoh connection failed',
      };
    }
  }

  // ─── Invitations ───────────────────────────────────────────

  async sendInvitation(
    source: ReviewSource,
    input: InvitationInput,
  ): Promise<SendInvitationResult> {
    const ctx = this.requireCreds(source);
    const body = await this.request<Record<string, unknown>>('invitation', {
      method: 'POST',
      apiHash: ctx.apiHash,
      body: {
        locationId: ctx.locationId,
        email: input.email,
        firstName: input.name ?? undefined,
        reference: input.orderRef ?? undefined,
      },
    });
    const externalId =
      body && typeof body.invitationId === 'string'
        ? body.invitationId
        : body && typeof body.id === 'string'
          ? body.id
          : undefined;
    return { externalId, raw: body ?? {} };
  }

  // ─── Reviews feed ──────────────────────────────────────────

  async fetchReviews(source: ReviewSource): Promise<FetchReviewsResult> {
    const ctx = this.requireCreds(source);
    const feed = await this.fetchFeed(ctx);
    return this.normalizeFeed(feed);
  }

  // ─── Internals ─────────────────────────────────────────────

  private async fetchFeed(ctx: KiyohContext): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('publication/review/external', {
      apiHash: ctx.apiHash,
      query: { locationId: ctx.locationId },
    });
  }

  /** Map a raw Kiyoh feed to the normalized summary + reviews. */
  normalizeFeed(feed: Record<string, unknown>): FetchReviewsResult {
    const rawReviews = Array.isArray(feed.reviews)
      ? (feed.reviews as Record<string, unknown>[])
      : [];
    const reviews: NormalizedReview[] = rawReviews.map((r) => ({
      externalId: String(r.reviewId ?? r.id ?? ''),
      rating: normalizeRating(r.rating ?? r.score),
      title: typeof r.title === 'string' ? r.title : null,
      body:
        typeof r.reviewContent === 'string'
          ? r.reviewContent
          : typeof r.comment === 'string'
            ? r.comment
            : null,
      authorName: typeof r.reviewAuthor === 'string' ? r.reviewAuthor : null,
      publishedAt: normalizeDate(r.dateSince ?? r.createdAt),
      raw: r,
    }));
    const average =
      feed.averageRating != null
        ? Number(feed.averageRating)
        : feed.locationAverageRating != null
          ? Number(feed.locationAverageRating)
          : null;
    const count =
      typeof feed.numberReviews === 'number'
        ? feed.numberReviews
        : Number(feed.numberReviews ?? reviews.length) || reviews.length;
    return {
      average: average != null && Number.isFinite(average) ? average : null,
      count,
      reviews,
    };
  }

  /** Authenticated Kiyoh request relative to the v1 base. */
  private async request<T = unknown>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      query?: Record<string, string | number>;
      apiHash: string;
    },
  ): Promise<T> {
    const url = new URL(`${KIYOH_BASE_URL}${path}`);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        url.searchParams.set(k, String(v));
      }
    }
    const method = init.method ?? 'GET';
    const hasBody = init.body !== undefined && init.body !== null;
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Accept: 'application/json',
        'X-Publication-Api-Token': init.apiHash,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(
        `kiyoh request failed (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`,
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

export const kiyohAdapter = new KiyohAdapter();
