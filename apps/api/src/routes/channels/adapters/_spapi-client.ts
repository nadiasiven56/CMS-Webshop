/**
 * _spapi-client — low-level Amazon Selling Partner API (SP-API) transport.
 *
 * This is the OFFICIAL contract, LWA-only (NO AWS SigV4 — SP-API dropped the
 * IAM/SigV4 requirement; a plain LWA access-token in `x-amz-access-token` is the
 * supported auth as of the current SP-API model). The client owns:
 *
 *   - LWA refresh-token grant against https://api.amazon.com/auth/o2/token,
 *     with a 1h access-token CACHE per channel + ~60s pre-expiry refresh.
 *   - Resource calls against the regional host, selected by region (eu/na/fe)
 *     and a sandbox toggle. The API version lives in the URL PATH.
 *   - Restricted Data Token (RDT) minting (POST /tokens/2021-03-01/restrictedDataToken)
 *     for buyer-PII order calls — the RDT is used as `x-amz-access-token`.
 *   - A per-operation token-bucket rate-limiter + 429 (QuotaExceeded)
 *     exponential-backoff-with-jitter retry.
 *   - Error normalization → typed {@link SpApiError}.
 *
 * Nothing here ever fires without credentials: callers (the adapter) gate every
 * use behind their `requireCreds()` guard. This module is pure transport and is
 * deliberately injectable (`fetchImpl`, `now`, `sleep`) so the unit-tests can
 * drive it with a fake fetch and a fake clock without any live network.
 */

// ─── Hosts / endpoints ───────────────────────────────────────────────────────

/** LWA token endpoint (global, region-independent). */
export const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** SP-API region → production host. EU is the default for this CRM (NL/DE/FR/BE). */
export const SP_API_HOSTS: Record<string, string> = {
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  na: 'https://sellingpartnerapi-na.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
};

/** SP-API region → sandbox host. */
export const SP_API_SANDBOX_HOSTS: Record<string, string> = {
  eu: 'https://sandbox.sellingpartnerapi-eu.amazon.com',
  na: 'https://sandbox.sellingpartnerapi-na.amazon.com',
  fe: 'https://sandbox.sellingpartnerapi-fe.amazon.com',
};

export const DEFAULT_REGION = 'eu';
export const DEFAULT_ENVIRONMENT = 'production' as const;

/**
 * Marketplace-id map for the regions this CRM targets. Keys are ISO-3166-2
 * country codes; values are Amazon marketplace ids. NL is the default.
 * (Source: SP-API "Marketplace IDs" reference.)
 */
export const MARKETPLACES: Record<string, { id: string; region: string; currency: string }> = {
  NL: { id: 'A1805IZSGTT6HS', region: 'eu', currency: 'EUR' },
  DE: { id: 'A1PA6795UKMFR9', region: 'eu', currency: 'EUR' },
  FR: { id: 'A13V1IB3VIYZZH', region: 'eu', currency: 'EUR' },
  BE: { id: 'AMEN7PMS3EDWL', region: 'eu', currency: 'EUR' },
  IT: { id: 'APJ6JRA9NG5V4', region: 'eu', currency: 'EUR' },
  ES: { id: 'A1RKKUPIHCS9HS', region: 'eu', currency: 'EUR' },
  GB: { id: 'A1F83G8C2ARO7P', region: 'eu', currency: 'GBP' },
  SE: { id: 'A2NODRKZP88ZB9', region: 'eu', currency: 'SEK' },
  PL: { id: 'A1C3SOZRARQ6R3', region: 'eu', currency: 'PLN' },
  US: { id: 'ATVPDKIKX0DER', region: 'na', currency: 'USD' },
  CA: { id: 'A2EUQ1WTGCTBG2', region: 'na', currency: 'CAD' },
  MX: { id: 'A1AM78C64UM0Y8', region: 'na', currency: 'MXN' },
  JP: { id: 'A1VC38T7YXB528', region: 'fe', currency: 'JPY' },
  AU: { id: 'A39IBJ37TRP1C6', region: 'fe', currency: 'AUD' },
};

/** Default NL marketplace id (Amazon.nl). */
export const DEFAULT_MARKETPLACE_ID = MARKETPLACES.NL!.id;

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Normalized SP-API error. SP-API returns either an LWA `{error, error_description}`
 * shape (token endpoint) or a resource `{errors:[{code,message,details}]}` shape.
 * Both are flattened here so callers get one consistent error type.
 */
export class SpApiError extends Error {
  readonly status: number;
  /** SP-API error code (e.g. 'QuotaExceeded', 'Unauthorized', 'invalid_grant'). */
  readonly code: string;
  /** The operation that failed (e.g. 'getOrders'), for log/triage. */
  readonly operation: string | undefined;
  /** Whether this error is a rate-limit (HTTP 429 / QuotaExceeded). */
  readonly isRateLimit: boolean;
  readonly details: unknown;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    operation?: string;
    details?: unknown;
  }) {
    super(args.message);
    this.name = 'SpApiError';
    this.status = args.status;
    this.code = args.code;
    this.operation = args.operation;
    this.isRateLimit = args.status === 429 || args.code === 'QuotaExceeded';
    this.details = args.details;
  }
}

/** Best-effort: turn an SP-API/LWA error body into a {code,message}. */
export function normalizeSpApiError(
  status: number,
  body: unknown,
  operation?: string,
): SpApiError {
  // LWA token-endpoint error shape.
  if (body && typeof body === 'object' && 'error' in body) {
    const b = body as { error?: unknown; error_description?: unknown };
    return new SpApiError({
      status,
      code: typeof b.error === 'string' ? b.error : `http_${status}`,
      message:
        typeof b.error_description === 'string'
          ? b.error_description
          : typeof b.error === 'string'
            ? b.error
            : `SP-API LWA error ${status}`,
      operation,
      details: body,
    });
  }
  // Resource error shape: { errors: [{ code, message, details }] }.
  if (body && typeof body === 'object' && Array.isArray((body as { errors?: unknown }).errors)) {
    const first = (body as { errors: Array<Record<string, unknown>> }).errors[0] ?? {};
    return new SpApiError({
      status,
      code: typeof first.code === 'string' ? first.code : `http_${status}`,
      message:
        typeof first.message === 'string' ? first.message : `SP-API error ${status}`,
      operation,
      details: body,
    });
  }
  return new SpApiError({
    status,
    code: status === 429 ? 'QuotaExceeded' : `http_${status}`,
    message: `SP-API request failed (${status})`,
    operation,
    details: body,
  });
}

// ─── Rate-limiter (token bucket per operation) ────────────────────────────────

/**
 * A single token-bucket. SP-API publishes a steady-state rate + burst per
 * operation; we model that as `rate` tokens/sec refilling up to `burst`.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    readonly rate: number,
    readonly burst: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = burst;
    this.last = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = (t - this.last) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
      this.last = t;
    }
  }

  /** Try to take a token; returns true on success (non-blocking). */
  tryRemove(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Milliseconds until at least one token is available. */
  msUntilToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.rate) * 1000);
  }
}

/**
 * Default per-operation rate limits (steady rate / burst). Conservative values
 * aligned with SP-API's published Orders/Listings limits; callers may override.
 */
export const DEFAULT_RATE_LIMITS: Record<string, { rate: number; burst: number }> = {
  getOrders: { rate: 0.0167, burst: 20 },
  getOrderItems: { rate: 0.5, burst: 30 },
  patchListingsItem: { rate: 5, burst: 10 },
  putListingsItem: { rate: 5, burst: 10 },
  createRestrictedDataToken: { rate: 0.5, burst: 30 },
  default: { rate: 5, burst: 10 },
};

// ─── Config / injectables ─────────────────────────────────────────────────────

export interface SpApiCredentials {
  lwaClientId: string;
  lwaClientSecret: string;
  refreshToken: string;
  sellerId?: string;
  marketplaceId: string;
  region: string;
  environment: 'sandbox' | 'production';
}

export interface SpApiClientDeps {
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Injectable clock (ms). Defaults to Date.now. */
  now?: () => number;
  /** Injectable sleep. Defaults to a real setTimeout-based delay. */
  sleep?: (ms: number) => Promise<void>;
  /** Max retries on 429/5xx. Default 4. */
  maxRetries?: number;
  /** Per-operation rate-limit overrides. */
  rateLimits?: Record<string, { rate: number; burst: number }>;
}

interface CachedToken {
  accessToken: string;
  /** Absolute ms epoch when the token expires. */
  expiresAt: number;
}

/**
 * SpApiClient — one instance per channel. Holds the LWA token cache + the
 * per-operation buckets. Pure transport; it knows nothing about the CRM.
 */
export class SpApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly rateLimits: Record<string, { rate: number; burst: number }>;
  private readonly buckets = new Map<string, TokenBucket>();
  /** Cached LWA access-token (1h). */
  private tokenCache: CachedToken | null = null;
  /** In-flight token refresh, so concurrent calls share one round-trip. */
  private tokenInFlight: Promise<string> | null = null;

  constructor(
    private readonly creds: SpApiCredentials,
    deps: SpApiClientDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as typeof fetch);
    this.now = deps.now ?? (() => Date.now());
    this.sleep =
      deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = deps.maxRetries ?? 4;
    this.rateLimits = { ...DEFAULT_RATE_LIMITS, ...(deps.rateLimits ?? {}) };
  }

  /** Resource host for this channel's region + environment. */
  get host(): string {
    const region = SP_API_HOSTS[this.creds.region] ? this.creds.region : DEFAULT_REGION;
    const table =
      this.creds.environment === 'sandbox' ? SP_API_SANDBOX_HOSTS : SP_API_HOSTS;
    return table[region] ?? table[DEFAULT_REGION]!;
  }

  /** Marketplace id for this channel. */
  get marketplaceId(): string {
    return this.creds.marketplaceId;
  }

  /** Seller/merchant id (or '_' fallback for the listings path). */
  get sellerId(): string {
    return this.creds.sellerId && this.creds.sellerId.length > 0
      ? this.creds.sellerId
      : '_';
  }

  // ── LWA token (cached) ──────────────────────────────────────────────────────

  /**
   * Build the exact x-www-form-urlencoded body for the LWA refresh_token grant.
   * Exposed (static) so the unit-tests can assert the body construction without
   * a network call.
   */
  static buildTokenBody(creds: Pick<
    SpApiCredentials,
    'refreshToken' | 'lwaClientId' | 'lwaClientSecret'
  >): URLSearchParams {
    return new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: creds.lwaClientId,
      client_secret: creds.lwaClientSecret,
    });
  }

  /**
   * Return a valid LWA access-token, using the 1h cache. Refreshes ~60s before
   * expiry. Concurrent callers share a single in-flight refresh.
   */
  async getAccessToken(): Promise<string> {
    const REFRESH_SKEW_MS = 60_000;
    if (this.tokenCache && this.tokenCache.expiresAt - this.now() > REFRESH_SKEW_MS) {
      return this.tokenCache.accessToken;
    }
    if (this.tokenInFlight) return this.tokenInFlight;

    this.tokenInFlight = (async () => {
      const body = SpApiClient.buildTokenBody(this.creds);
      const res = await this.fetchImpl(LWA_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });
      const json = (await this.safeJson(res)) as
        | { access_token?: string; expires_in?: number }
        | Record<string, unknown>;
      if (!res.ok) {
        throw normalizeSpApiError(res.status, json, 'lwaToken');
      }
      const accessToken = (json as { access_token?: string }).access_token;
      if (!accessToken) {
        throw new SpApiError({
          status: res.status,
          code: 'no_access_token',
          message: 'LWA token response had no access_token',
          operation: 'lwaToken',
          details: json,
        });
      }
      const expiresIn = (json as { expires_in?: number }).expires_in ?? 3600;
      this.tokenCache = {
        accessToken,
        expiresAt: this.now() + expiresIn * 1000,
      };
      return accessToken;
    })();

    try {
      return await this.tokenInFlight;
    } finally {
      this.tokenInFlight = null;
    }
  }

  /**
   * Mint a Restricted Data Token (RDT) for buyer-PII access. The RDT replaces
   * the regular access-token in `x-amz-access-token` for the restricted call.
   * RDTs are short-lived and NOT cached here (each restricted batch mints fresh).
   */
  async getRdt(restrictedResources: Array<{
    method: string;
    path: string;
    dataElements?: string[];
  }>): Promise<string> {
    const json = (await this.request<{ restrictedDataToken?: string }>('createRestrictedDataToken', {
      method: 'POST',
      path: '/tokens/2021-03-01/restrictedDataToken',
      body: { restrictedResources },
    })) as { restrictedDataToken?: string };
    if (!json.restrictedDataToken) {
      throw new SpApiError({
        status: 200,
        code: 'no_rdt',
        message: 'RDT response had no restrictedDataToken',
        operation: 'createRestrictedDataToken',
      });
    }
    return json.restrictedDataToken;
  }

  // ── Generic resource request ─────────────────────────────────────────────────

  private bucketFor(operation: string): TokenBucket {
    let b = this.buckets.get(operation);
    if (!b) {
      const cfg = this.rateLimits[operation] ?? this.rateLimits.default!;
      b = new TokenBucket(cfg.rate, cfg.burst, this.now);
      this.buckets.set(operation, b);
    }
    return b;
  }

  private async safeJson(res: { json: () => Promise<unknown> }): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Perform a (path-versioned) SP-API resource request with: per-operation
   * token-bucket pacing, 429/5xx exponential backoff + jitter, and error
   * normalization. `accessToken` may be overridden with an RDT for restricted
   * resources; otherwise the cached LWA token is used.
   */
  async request<T = unknown>(
    operation: string,
    opts: {
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      /** Path WITH the API version (e.g. '/orders/v0/orders'). */
      path: string;
      query?: Record<string, string | undefined>;
      body?: unknown;
      /** Override the x-amz-access-token (RDT for restricted resources). */
      accessToken?: string;
    },
  ): Promise<T> {
    const bucket = this.bucketFor(operation);
    let attempt = 0;
    // Pace against the local bucket first (avoid firing into a known-empty quota).
    while (!bucket.tryRemove()) {
      await this.sleep(bucket.msUntilToken());
    }

    for (;;) {
      const token = opts.accessToken ?? (await this.getAccessToken());
      const url = new URL(opts.path, this.host);
      if (opts.query) {
        for (const [k, v] of Object.entries(opts.query)) {
          if (v !== undefined) url.searchParams.set(k, v);
        }
      }
      const headers: Record<string, string> = {
        // CRITICAL: SP-API uses x-amz-access-token, NOT Authorization: Bearer.
        'x-amz-access-token': token,
        Accept: 'application/json',
      };
      const init: RequestInit = { method: opts.method, headers };
      if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }

      const res = await this.fetchImpl(url.toString(), init);
      if (res.ok) {
        // 204/empty → null cast to T.
        if (res.status === 204) return null as T;
        return (await this.safeJson(res)) as T;
      }

      const errBody = await this.safeJson(res);
      const err = normalizeSpApiError(res.status, errBody, operation);

      // Retry on 429 (QuotaExceeded) and transient 5xx; otherwise surface.
      const retryable = err.isRateLimit || (res.status >= 500 && res.status < 600);
      if (!retryable || attempt >= this.maxRetries) {
        throw err;
      }
      const wait = this.backoffMs(attempt, res);
      attempt += 1;
      await this.sleep(wait);
    }
  }

  /**
   * Exponential backoff with full jitter. Honors a `Retry-After` header
   * (seconds) when present, otherwise base 500ms * 2^attempt capped at 30s.
   */
  backoffMs(attempt: number, res?: { headers?: { get(name: string): string | null } }): number {
    const retryAfter = res?.headers?.get?.('retry-after');
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 60_000);
    }
    const base = Math.min(500 * 2 ** attempt, 30_000);
    // Full jitter: random in [0, base].
    return Math.floor(Math.random() * base);
  }
}
