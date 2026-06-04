/**
 * MollieProvider — official Mollie Payments API v2 implementation of the
 * {@link PaymentProvider} contract (Wave-H A4).
 *
 * This is CONNECT-READY: the full official contract is implemented exactly, but
 * NOTHING fires without a key. The provider is constructed with a decrypted API
 * key; the factory (`getPaymentProvider`) only returns an instance when the shop
 * has `payment_provider='mollie'` + a non-empty key. If a key is somehow missing
 * at construction, the constructor throws {@link PaymentNotConnectedError} so no
 * request can leak.
 *
 * Official spec implemented here (https://docs.mollie.com/reference/v2):
 *   - Auth: `Authorization: Bearer <key>`. The key PREFIX selects the mode —
 *     `test_…` = test mode, `live_…` = live mode — against the SAME host
 *     https://api.mollie.com (no separate sandbox host).
 *   - Create payment:  POST /v2/payments
 *       body  { amount:{currency, value:'<2-dec string>'}, description,
 *               redirectUrl, webhookUrl, metadata:{orderId} }
 *       hdrs  Authorization: Bearer, Content-Type: application/json,
 *             Idempotency-Key: <uuid>
 *       → 201 { id, status, _links.checkout.href, metadata }
 *   - Get status:      GET  /v2/payments/{id}            → { status, metadata }
 *   - Refund:          POST /v2/payments/{id}/refunds
 *       body { amount:{currency, value} } (omit for full refund)
 *
 * Rate-limit handling: a 429 is retried with exponential backoff (honouring the
 * `Retry-After` header when present). All non-OK responses become a typed
 * {@link PaymentProviderError}.
 */
import { randomUUID } from 'node:crypto';
import {
  PaymentNotConnectedError,
  PaymentProviderError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProvider,
  type PaymentStatus,
} from './types.js';

const MOLLIE_API_BASE = 'https://api.mollie.com';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

/** Map Mollie's payment.status to our normalized {@link PaymentStatus}. */
export function mapMollieStatus(raw: unknown): PaymentStatus {
  switch (raw) {
    case 'open':
      return 'open';
    case 'pending':
      return 'pending';
    case 'authorized':
      return 'authorized';
    case 'paid':
      return 'paid';
    case 'failed':
      return 'failed';
    case 'expired':
      return 'expired';
    case 'canceled':
      return 'canceled';
    default:
      return 'unknown';
  }
}

/** Shape of the bits of a Mollie payment object we consume. */
interface MolliePaymentResponse {
  id?: string;
  status?: string;
  metadata?: Record<string, unknown> | null;
  _links?: { checkout?: { href?: string } | null } | null;
}

export class MollieProvider implements PaymentProvider {
  readonly provider = 'mollie';
  private readonly apiKey: string;

  constructor(apiKey: string | null | undefined) {
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key) {
      // Defence-in-depth: the factory already guards this, but never allow an
      // instance without a key to exist — so no method can fire keyless.
      throw new PaymentNotConnectedError('Mollie credentials required');
    }
    this.apiKey = key;
  }

  /** Whether this key targets Mollie test mode (prefix `test_`). */
  get isTestMode(): boolean {
    return this.apiKey.startsWith('test_');
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extra,
    };
  }

  /**
   * Fetch with 429-aware exponential backoff. Returns the parsed JSON on a 2xx;
   * throws a typed {@link PaymentProviderError} otherwise. Network errors bubble
   * as PaymentProviderError too so the route-layer has one error-type to handle.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${MOLLIE_API_BASE}${path}`;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: this.headers(extraHeaders),
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        throw new PaymentProviderError(
          `mollie ${method} ${path} network error: ${
            err instanceof Error ? err.message : 'fetch failed'
          }`,
        );
      }

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : BASE_BACKOFF_MS * 2 ** attempt;
        attempt += 1;
        await delay(waitMs);
        continue;
      }

      if (!res.ok) {
        const detail = await safeErrorDetail(res);
        throw new PaymentProviderError(
          `mollie ${method} ${path} failed: ${res.status} ${detail}`,
          res.status,
        );
      }

      // 204-style empty bodies are not expected on the endpoints we call, but
      // guard against them so JSON.parse never throws on ''.
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const payload = {
      amount: { currency: input.currency, value: input.amountValue },
      description: input.description,
      redirectUrl: input.redirectUrl,
      webhookUrl: input.webhookUrl,
      metadata: { orderId: input.orderId },
    };
    const json = await this.request<MolliePaymentResponse>(
      'POST',
      '/v2/payments',
      payload,
      { 'Idempotency-Key': randomUUID() },
    );
    if (!json.id) {
      throw new PaymentProviderError('mollie createPayment: response missing id');
    }
    return {
      providerPaymentId: json.id,
      checkoutUrl: json._links?.checkout?.href ?? null,
      status: mapMollieStatus(json.status),
    };
  }

  async getStatus(providerPaymentId: string): Promise<PaymentStatus> {
    const json = await this.request<MolliePaymentResponse>(
      'GET',
      `/v2/payments/${encodeURIComponent(providerPaymentId)}`,
    );
    return mapMollieStatus(json.status);
  }

  /**
   * Fetch the full payment (status + metadata). Used by the webhook to read the
   * authoritative status AND the round-tripped metadata.orderId in one call.
   */
  async getPayment(
    providerPaymentId: string,
  ): Promise<{ status: PaymentStatus; orderId: string | null; raw: MolliePaymentResponse }> {
    const json = await this.request<MolliePaymentResponse>(
      'GET',
      `/v2/payments/${encodeURIComponent(providerPaymentId)}`,
    );
    const meta = json.metadata ?? null;
    const orderId =
      meta && typeof meta.orderId === 'string' ? meta.orderId : null;
    return { status: mapMollieStatus(json.status), orderId, raw: json };
  }

  async refund(
    providerPaymentId: string,
    amountValue?: string,
  ): Promise<PaymentStatus> {
    const body =
      amountValue !== undefined
        ? { amount: { currency: 'EUR', value: amountValue } }
        : {};
    await this.request<{ status?: string }>(
      'POST',
      `/v2/payments/${encodeURIComponent(providerPaymentId)}/refunds`,
      body,
      { 'Idempotency-Key': randomUUID() },
    );
    // A successful refund leaves the payment 'paid'; status normalizes here.
    return 'refunded';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort error-detail extraction from a Mollie error envelope. */
async function safeErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return '';
    try {
      const json = JSON.parse(text) as { detail?: string; title?: string };
      return json.detail ?? json.title ?? text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return '';
  }
}
