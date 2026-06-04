/**
 * TrustpilotAdapter — CONNECT-READY adapter for the Trustpilot API.
 *
 * Implements the official Trustpilot contract (OAuth2 → Bearer token, base
 * `https://api.trustpilot.com/v1/`, Invitations API + business-units reviews)
 * but is READY UP TO THE KEY-ENTRY POINT: nothing live ever fires without
 * credentials. Every network-touching method first calls the private
 * `requireCreds()` guard, which throws a typed
 * {@link ReviewSourceNotConnectedError} ('Trustpilot credentials required') when
 * the source is not `status='connected'` or apiKey/apiSecret are empty.
 *
 * Credentials shape (stored encrypted, decrypted in-memory by the adapter):
 *   { apiKey: string, apiSecret: string }
 * Config (plain jsonb on the source):
 *   { businessUnitId: string }
 *
 * Auth: OAuth2 against `https://api.trustpilot.com/v1/oauth/oauth-token` with a
 * `Basic base64(apiKey:apiSecret)` header and a `grant_type=client_credentials`
 * form body, yielding a Bearer token cached in-memory per source. Resource calls
 * send `Authorization: Bearer <token>`.
 *
 * Endpoints used:
 *   - POST /v1/oauth/oauth-token                                  (token)
 *   - GET  /v1/business-units/{businessUnitId}                    (summary)
 *   - GET  /v1/business-units/{businessUnitId}/reviews            (review feed)
 *   - POST /v1/private/business-units/{businessUnitId}/email-invitations (invite)
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

/** Official Trustpilot API base. */
const TRUSTPILOT_BASE_URL = 'https://api.trustpilot.com/v1/';
const TRUSTPILOT_TOKEN_PATH = 'oauth/oauth-token';
/** Seconds before token expiry at which we proactively refresh. */
const TOKEN_REFRESH_SKEW_SECONDS = 30;

interface TrustpilotContext {
  apiKey: string;
  apiSecret: string;
  businessUnitId: string;
  sourceId: string;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
  apiKey: string;
}

/** Process-wide token cache, keyed by source id. */
const tokenCache = new Map<string, CachedToken>();

/** Test/maintenance helper — drop a cached token (or all of them). */
export function clearTrustpilotTokenCache(cacheKey?: string): void {
  if (cacheKey) tokenCache.delete(cacheKey);
  else tokenCache.clear();
}

export class TrustpilotAdapter implements ReviewAdapter {
  readonly provider = 'trustpilot';

  // ─── Credential resolution ─────────────────────────────────

  private requireCreds(source: ReviewSource): TrustpilotContext {
    if (source.status !== 'connected') {
      throw new ReviewSourceNotConnectedError('Trustpilot credentials required');
    }
    const creds = decryptCredentials(
      (source.credentials ?? null) as { enc: string } | null,
    );
    const apiKey = creds && typeof creds.apiKey === 'string' ? creds.apiKey : '';
    const apiSecret =
      creds && typeof creds.apiSecret === 'string' ? creds.apiSecret : '';
    if (!apiKey || !apiSecret) {
      throw new ReviewSourceNotConnectedError('Trustpilot credentials required');
    }
    const cfg = (source.config ?? {}) as { businessUnitId?: unknown };
    const businessUnitId =
      typeof cfg.businessUnitId === 'string' ? cfg.businessUnitId : '';
    return { apiKey, apiSecret, businessUnitId, sourceId: source.id };
  }

  // ─── Connection check (never throws) ───────────────────────

  async verifyConnection(source: ReviewSource): Promise<VerifyResult> {
    let ctx: TrustpilotContext;
    try {
      ctx = this.requireCreds(source);
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Trustpilot credentials required',
      };
    }
    try {
      await this.getToken(ctx);
      return {
        ok: true,
        detail: ctx.businessUnitId
          ? `Trustpilot verbonden (business-unit ${ctx.businessUnitId}).`
          : 'Trustpilot verbonden (geen businessUnitId in config).',
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'trustpilot connection failed',
      };
    }
  }

  // ─── Invitations ───────────────────────────────────────────

  async sendInvitation(
    source: ReviewSource,
    input: InvitationInput,
  ): Promise<SendInvitationResult> {
    const ctx = this.requireCreds(source);
    const body = await this.request<Record<string, unknown>>(
      `private/business-units/${encodeURIComponent(ctx.businessUnitId)}/email-invitations`,
      {
        ctx,
        method: 'POST',
        body: {
          consumerEmail: input.email,
          consumerName: input.name ?? undefined,
          referenceNumber: input.orderRef ?? undefined,
          locale: 'nl-NL',
        },
      },
    );
    const externalId =
      body && typeof body.id === 'string'
        ? body.id
        : body && typeof body.invitationId === 'string'
          ? body.invitationId
          : undefined;
    return { externalId, raw: body ?? {} };
  }

  // ─── Reviews feed ──────────────────────────────────────────

  async fetchReviews(source: ReviewSource): Promise<FetchReviewsResult> {
    const ctx = this.requireCreds(source);
    const [summary, feed] = await Promise.all([
      this.request<Record<string, unknown>>(
        `business-units/${encodeURIComponent(ctx.businessUnitId)}`,
        { ctx },
      ),
      this.request<Record<string, unknown>>(
        `business-units/${encodeURIComponent(ctx.businessUnitId)}/reviews`,
        { ctx, query: { perPage: 50, orderBy: 'createdat.desc' } },
      ),
    ]);
    return this.normalizeFeed(summary ?? {}, feed ?? {});
  }

  /** Map raw Trustpilot summary + review feed to the normalized shape. */
  normalizeFeed(
    summary: Record<string, unknown>,
    feed: Record<string, unknown>,
  ): FetchReviewsResult {
    const rawReviews = Array.isArray(feed.reviews)
      ? (feed.reviews as Record<string, unknown>[])
      : [];
    const reviews: NormalizedReview[] = rawReviews.map((r) => {
      const consumer = (r.consumer ?? {}) as Record<string, unknown>;
      return {
        externalId: String(r.id ?? ''),
        rating: normalizeRating(r.stars ?? r.rating),
        title: typeof r.title === 'string' ? r.title : null,
        body: typeof r.text === 'string' ? r.text : null,
        authorName:
          typeof consumer.displayName === 'string' ? consumer.displayName : null,
        publishedAt: normalizeDate(r.createdAt),
        raw: r,
      };
    });
    const score = (summary.score ?? {}) as Record<string, unknown>;
    const average =
      score.trustScore != null
        ? Number(score.trustScore)
        : score.stars != null
          ? Number(score.stars)
          : null;
    const count =
      typeof summary.numberOfReviews === 'object' && summary.numberOfReviews !== null
        ? Number(
            (summary.numberOfReviews as Record<string, unknown>).total ??
              reviews.length,
          ) || reviews.length
        : typeof summary.numberOfReviews === 'number'
          ? summary.numberOfReviews
          : reviews.length;
    return {
      average: average != null && Number.isFinite(average) ? average : null,
      count,
      reviews,
    };
  }

  // ─── OAuth + request ───────────────────────────────────────

  private async getToken(ctx: TrustpilotContext): Promise<string> {
    const cached = tokenCache.get(ctx.sourceId);
    if (cached && cached.apiKey === ctx.apiKey && cached.expiresAtMs > Date.now()) {
      return cached.token;
    }
    const basic = Buffer.from(`${ctx.apiKey}:${ctx.apiSecret}`, 'utf8').toString(
      'base64',
    );
    const res = await fetch(`${TRUSTPILOT_BASE_URL}${TRUSTPILOT_TOKEN_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(
        `trustpilot token request failed (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      );
    }
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) {
      throw new Error('trustpilot token response had no access_token');
    }
    const expiresInSeconds =
      typeof json.expires_in === 'number' && json.expires_in > 0
        ? json.expires_in
        : 3600;
    tokenCache.set(ctx.sourceId, {
      token: json.access_token,
      expiresAtMs:
        Date.now() + Math.max(0, expiresInSeconds - TOKEN_REFRESH_SKEW_SECONDS) * 1000,
      apiKey: ctx.apiKey,
    });
    return json.access_token;
  }

  /** Authenticated Trustpilot request relative to the v1 base. */
  private async request<T = unknown>(
    path: string,
    init: {
      ctx: TrustpilotContext;
      method?: string;
      body?: unknown;
      query?: Record<string, string | number>;
    },
  ): Promise<T> {
    const token = await this.getToken(init.ctx);
    const url = new URL(`${TRUSTPILOT_BASE_URL}${path}`);
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
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(
        `trustpilot request failed (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`,
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

export const trustpilotAdapter = new TrustpilotAdapter();
