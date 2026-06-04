/**
 * _bol-client — low-level HTTP client for the bol.com Retailer API v10.
 *
 * This module owns the *wire protocol* details so the {@link ./bol.ts BolAdapter}
 * stays a thin mapping layer. It implements the OFFICIAL contract exactly:
 *
 *   - OAuth2 client-credentials against https://login.bol.com/token, with a
 *     `Basic base64(clientId:clientSecret)` header and an
 *     `application/x-www-form-urlencoded` body of `grant_type=client_credentials`.
 *   - The returned JWT is CACHED in-memory per channel and reused until ~30s
 *     before `expires_in`, so we never fetch a token per request.
 *   - Resource calls send `Authorization: Bearer <jwt>` plus the v10 media-type
 *     headers (`application/vnd.retailer.v10+json`) and target the demo or
 *     production base URL depending on `environment` ('demo' by default).
 *   - On HTTP 429 the client honours `Retry-After` and backs off; vendor errors
 *     are normalized to a typed {@link BolApiError}.
 *   - Bol's write endpoints (POST/PUT) return a `ProcessStatus` envelope; this
 *     client exposes {@link BolClient.pollProcessStatus} to poll
 *     `GET /process-status/{id}` until the status leaves PENDING.
 *
 * NOTHING here fires a request on its own — the adapter constructs a client only
 * AFTER its `requireCreds()` guard has proven the channel is connected with a
 * non-empty clientId/clientSecret.
 */

/** OAuth + resource endpoints. */
const BOL_LOGIN_URL = 'https://login.bol.com/token';
const BOL_API_BASE_PROD = 'https://api.bol.com/retailer';
const BOL_API_BASE_DEMO = 'https://api.bol.com/retailer-demo';

/** v10 media type — required on both Accept and (for bodies) Content-Type. */
export const BOL_MEDIA_TYPE_V10 = 'application/vnd.retailer.v10+json';

/** Seconds before token expiry at which we proactively refresh. */
const TOKEN_REFRESH_SKEW_SECONDS = 30;

/** Default + cap on 429 backoff so a misbehaving Retry-After can't hang us. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;
const MAX_RETRY_AFTER_SECONDS = 60;
/** How many times we retry a single request after a 429. */
const MAX_RATE_LIMIT_RETRIES = 3;

/** Process-status polling cadence. */
const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 30;

export type BolEnvironment = 'demo' | 'production';

export interface BolClientOptions {
  clientId: string;
  clientSecret: string;
  environment: BolEnvironment;
  /**
   * Stable cache key for the token (the channel id). Token caching is keyed by
   * `cacheKey + clientId` so rotating credentials invalidates the cached token.
   */
  cacheKey: string;
  /** Injectable fetch + clock for tests (defaults to global fetch / Date.now). */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Injectable sleeper so unit tests don't actually wait on backoff. */
  sleep?: (ms: number) => Promise<void>;
}

/** Bol async-operation envelope returned by every POST/PUT. */
export interface BolProcessStatus {
  processStatusId: string;
  entityId: string | null;
  eventType: string | null;
  status: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'TIMEOUT';
  errorMessage: string | null;
  /** Original payload, kept for audit/debug. */
  raw: Record<string, unknown>;
}

/**
 * Normalized vendor error. Carries the HTTP status + (when bol returns one) the
 * structured `{ type, title, status, violations }` problem body so the route
 * layer can surface a useful message without leaking internals.
 */
export class BolApiError extends Error {
  readonly error = 'bol_api_error' as const;
  readonly httpStatus: number;
  readonly bolType: string | null;
  readonly violations: Array<{ name?: string; reason?: string }>;
  constructor(
    message: string,
    httpStatus: number,
    bolType: string | null = null,
    violations: Array<{ name?: string; reason?: string }> = [],
  ) {
    super(message);
    this.name = 'BolApiError';
    this.httpStatus = httpStatus;
    this.bolType = bolType;
    this.violations = violations;
  }
}

/** Type-guard usable across module realms. */
export function isBolApiError(e: unknown): e is BolApiError {
  return (
    e instanceof BolApiError ||
    (typeof e === 'object' &&
      e !== null &&
      (e as { error?: unknown }).error === 'bol_api_error')
  );
}

interface CachedToken {
  token: string;
  /** Epoch ms at which the token should be considered stale. */
  expiresAtMs: number;
  /** clientId the token was minted for (rotation invalidation). */
  clientId: string;
}

/** Process-wide token cache, keyed by channel id. */
const tokenCache = new Map<string, CachedToken>();

/** Test/maintenance helper — drop a cached token (or all of them). */
export function clearBolTokenCache(cacheKey?: string): void {
  if (cacheKey) tokenCache.delete(cacheKey);
  else tokenCache.clear();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Resolve the resource base URL for an environment. Defaults to the demo host so
 * a freshly-connected channel can never accidentally hit production before the
 * operator explicitly flips `config.environment` to 'production'.
 */
export function bolApiBaseUrl(environment: BolEnvironment): string {
  return environment === 'production' ? BOL_API_BASE_PROD : BOL_API_BASE_DEMO;
}

/**
 * Build the OAuth `Basic` header value for a client id/secret pair. Exposed for
 * unit-testing the exact base64(`clientId:clientSecret`) construction.
 */
export function buildBasicAuthHeader(clientId: string, clientSecret: string): string {
  const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  return `Basic ${basic}`;
}

/** Standard v10 resource headers for a given bearer token. */
export function bolResourceHeaders(
  token: string,
  withBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: BOL_MEDIA_TYPE_V10,
  };
  if (withBody) headers['Content-Type'] = BOL_MEDIA_TYPE_V10;
  return headers;
}

export class BolClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly environment: BolEnvironment;
  private readonly cacheKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: BolClientOptions) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.environment = opts.environment;
    this.cacheKey = opts.cacheKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get baseUrl(): string {
    return bolApiBaseUrl(this.environment);
  }

  // ─── OAuth ─────────────────────────────────────────────────

  /**
   * Return a valid bearer token, minting a fresh one only when the cache is
   * empty/stale or the cached token belongs to a different clientId.
   */
  async getToken(): Promise<string> {
    const cached = tokenCache.get(this.cacheKey);
    if (
      cached &&
      cached.clientId === this.clientId &&
      cached.expiresAtMs > this.now()
    ) {
      return cached.token;
    }
    return this.fetchToken();
  }

  private async fetchToken(): Promise<string> {
    const res = await this.fetchImpl(BOL_LOGIN_URL, {
      method: 'POST',
      headers: {
        Authorization: buildBasicAuthHeader(this.clientId, this.clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new BolApiError(
        `bol token request failed (${res.status})${detail ? `: ${detail}` : ''}`,
        res.status,
      );
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new BolApiError('bol token response had no access_token', res.status);
    }
    const expiresInSeconds =
      typeof json.expires_in === 'number' && json.expires_in > 0
        ? json.expires_in
        : 299;
    const expiresAtMs =
      this.now() + Math.max(0, expiresInSeconds - TOKEN_REFRESH_SKEW_SECONDS) * 1000;
    tokenCache.set(this.cacheKey, {
      token: json.access_token,
      expiresAtMs,
      clientId: this.clientId,
    });
    return json.access_token;
  }

  // ─── Core request (auth + 429 backoff + error normalization) ──

  /**
   * Perform an authenticated v10 request relative to the resource base URL.
   * Handles bearer injection, 429 backoff (honouring Retry-After) and vendor
   * error normalization. Returns the parsed JSON (or `undefined` on 204).
   */
  async request<T = unknown>(
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string | number> } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        url.searchParams.set(k, String(v));
      }
    }
    const method = init.method ?? 'GET';
    const hasBody = init.body !== undefined && init.body !== null;

    let attempt = 0;
    // Loop only on 429; every other outcome returns/throws immediately.
    for (;;) {
      const token = await this.getToken();
      const res = await this.fetchImpl(url.toString(), {
        method,
        headers: bolResourceHeaders(token, hasBody),
        body: hasBody ? JSON.stringify(init.body) : undefined,
      });

      if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        attempt += 1;
        await this.sleep(this.retryAfterMs(res));
        continue;
      }

      if (!res.ok) {
        throw await this.normalizeError(res);
      }

      if (res.status === 204) return undefined as unknown as T;
      const text = await safeReadText(res);
      if (!text) return undefined as unknown as T;
      return JSON.parse(text) as T;
    }
  }

  /** Read Retry-After (seconds or HTTP-date), clamped to a sane ceiling. */
  private retryAfterMs(res: Response): number {
    const header = res.headers.get('retry-after');
    if (!header) return DEFAULT_RETRY_AFTER_SECONDS * 1000;
    const asInt = Number.parseInt(header, 10);
    if (Number.isFinite(asInt) && String(asInt) === header.trim()) {
      return clampSeconds(asInt) * 1000;
    }
    const asDate = Date.parse(header);
    if (Number.isFinite(asDate)) {
      const deltaMs = asDate - this.now();
      return Math.min(Math.max(deltaMs, 0), MAX_RETRY_AFTER_SECONDS * 1000);
    }
    return DEFAULT_RETRY_AFTER_SECONDS * 1000;
  }

  /** Map a non-ok response to a typed {@link BolApiError}. */
  private async normalizeError(res: Response): Promise<BolApiError> {
    const text = await safeReadText(res);
    let bolType: string | null = null;
    let title: string | null = null;
    let violations: Array<{ name?: string; reason?: string }> = [];
    if (text) {
      try {
        const body = JSON.parse(text) as {
          type?: string;
          title?: string;
          detail?: string;
          violations?: Array<{ name?: string; reason?: string }>;
        };
        bolType = typeof body.type === 'string' ? body.type : null;
        title =
          typeof body.title === 'string'
            ? body.title
            : typeof body.detail === 'string'
              ? body.detail
              : null;
        if (Array.isArray(body.violations)) violations = body.violations;
      } catch {
        title = text.slice(0, 300);
      }
    }
    const message =
      title ?? `bol request failed (${res.status} ${res.statusText || ''})`.trim();
    return new BolApiError(message, res.status, bolType, violations);
  }

  // ─── Async ProcessStatus polling ──────────────────────────

  /** Parse a raw bol ProcessStatus body into our typed shape. */
  static parseProcessStatus(raw: Record<string, unknown>): BolProcessStatus {
    const statusRaw = typeof raw.status === 'string' ? raw.status.toUpperCase() : 'PENDING';
    const status: BolProcessStatus['status'] =
      statusRaw === 'SUCCESS' || statusRaw === 'FAILURE' || statusRaw === 'TIMEOUT'
        ? statusRaw
        : 'PENDING';
    return {
      processStatusId: String(raw.processStatusId ?? raw.id ?? ''),
      entityId: typeof raw.entityId === 'string' ? raw.entityId : null,
      eventType: typeof raw.eventType === 'string' ? raw.eventType : null,
      status,
      errorMessage: typeof raw.errorMessage === 'string' ? raw.errorMessage : null,
      raw,
    };
  }

  /**
   * Poll `GET /process-status/{id}` until the status leaves PENDING (or we hit
   * the attempt ceiling, surfaced as a TIMEOUT). Returns the final status; a
   * FAILURE is returned (not thrown) so callers can decide how to react.
   */
  async pollProcessStatus(processStatusId: string): Promise<BolProcessStatus> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
      const raw = await this.request<Record<string, unknown>>(
        `/process-status/${encodeURIComponent(processStatusId)}`,
      );
      const parsed = BolClient.parseProcessStatus(raw ?? {});
      if (parsed.status !== 'PENDING') return parsed;
      await this.sleep(POLL_INTERVAL_MS);
    }
    return {
      processStatusId,
      entityId: null,
      eventType: null,
      status: 'TIMEOUT',
      errorMessage: `process-status ${processStatusId} still PENDING after ${POLL_MAX_ATTEMPTS} polls`,
      raw: {},
    };
  }
}

function clampSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
