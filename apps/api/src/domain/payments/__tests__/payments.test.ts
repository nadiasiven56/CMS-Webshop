/**
 * Unit-tests voor de payments-domain (Wave-H A4).
 *
 * Strategie (geen DB, geen live PSP):
 *   - global `fetch` mocken zodat we de EXACTE Mollie-request-shaping kunnen
 *     asserteren (host/pad/method, Bearer-key, Content-Type, Idempotency-Key,
 *     amount-string, body) zonder ook maar 1 echte call te doen.
 *   - de factory testen op null-bij-niet-geconfigureerd (non-breaking signaal)
 *     én op een echte MollieProvider bij geldige (encrypted) creds.
 *   - amount-conversie (numeric(12,4)-string → 2-dec) + status-mapping.
 *
 * env.CHANNEL_SECRET_KEY moet >=32 chars zijn vóór de import (channel-crypto
 * valideert env bij module-load via de factory).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

beforeAll(() => {
  if (!process.env.CHANNEL_SECRET_KEY || process.env.CHANNEL_SECRET_KEY.length < 32) {
    process.env.CHANNEL_SECRET_KEY = 'test-channel-secret-key-0123456789abcdef';
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    process.env.SESSION_SECRET = 'test-session-secret-key-0123456789abcdef';
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgres://localhost:7432/webshop_crm_test';
  }
});

const { MollieProvider, mapMollieStatus } = await import('../mollie.js');
const { toAmountValue, PaymentNotConnectedError, isPaymentNotConnectedError } =
  await import('../types.js');
const { getPaymentProvider, SUPPORTED_PAYMENT_PROVIDERS } = await import('../index.js');
const { encryptCredentials } = await import('../../../lib/channel-crypto.js');

// ─── fetch-mock helper ────────────────────────────────────────

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function installFetchMock(
  responder: (call: RecordedCall) => { status: number; json?: unknown; headers?: Record<string, string> },
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    const call: RecordedCall = {
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
      body,
    };
    calls.push(call);
    const r = responder(call);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (k: string) => (r.headers ?? {})[k.toLowerCase()] ?? null },
      text: async () => (r.json !== undefined ? JSON.stringify(r.json) : ''),
    } as unknown as Response;
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── toAmountValue ────────────────────────────────────────────

describe('toAmountValue (numeric(12,4) → PSP 2-dec string)', () => {
  it('formats a 4-decimal money string to exactly 2 decimals', () => {
    expect(toAmountValue('10.0000')).toBe('10.00');
    expect(toAmountValue('19.9900')).toBe('19.99');
    expect(toAmountValue('0.5000')).toBe('0.50');
  });
  it('rounds a 4-decimal money string to the nearest cent', () => {
    // numeric(12,4) inputs (the only thing checkout ever passes): rounds via
    // cents, consistent with the project-wide toCents() convention.
    expect(toAmountValue('2.9949')).toBe('2.99');
    expect(toAmountValue('2.9951')).toBe('3.00');
    expect(toAmountValue('100.1250')).toBe('100.13');
  });
  it('throws on non-finite input (never ships a bad total)', () => {
    expect(() => toAmountValue('not-a-number')).toThrow();
  });
});

// ─── mapMollieStatus ──────────────────────────────────────────

describe('mapMollieStatus', () => {
  it('maps the documented Mollie statuses', () => {
    expect(mapMollieStatus('open')).toBe('open');
    expect(mapMollieStatus('paid')).toBe('paid');
    expect(mapMollieStatus('failed')).toBe('failed');
    expect(mapMollieStatus('expired')).toBe('expired');
    expect(mapMollieStatus('canceled')).toBe('canceled');
    expect(mapMollieStatus('pending')).toBe('pending');
    expect(mapMollieStatus('authorized')).toBe('authorized');
  });
  it('maps anything unknown to "unknown"', () => {
    expect(mapMollieStatus('something_else')).toBe('unknown');
    expect(mapMollieStatus(undefined)).toBe('unknown');
  });
});

// ─── MollieProvider constructor guard ─────────────────────────

describe('MollieProvider construction guard', () => {
  it('throws PaymentNotConnectedError when key is empty', () => {
    expect(() => new MollieProvider('')).toThrow(PaymentNotConnectedError);
    expect(() => new MollieProvider('   ')).toThrow(PaymentNotConnectedError);
    expect(() => new MollieProvider(null)).toThrow(PaymentNotConnectedError);
  });
  it('selects test mode from the key prefix', () => {
    expect(new MollieProvider('test_abc123').isTestMode).toBe(true);
    expect(new MollieProvider('live_abc123').isTestMode).toBe(false);
  });
});

// ─── createPayment request shaping (THE official contract) ────

describe('MollieProvider.createPayment request shaping', () => {
  it('hits POST https://api.mollie.com/v2/payments with the exact contract', async () => {
    const calls = installFetchMock(() => ({
      status: 201,
      json: {
        id: 'tr_test123',
        status: 'open',
        _links: { checkout: { href: 'https://www.mollie.com/checkout/tr_test123' } },
      },
    }));

    const provider = new MollieProvider('test_KEY_abc');
    const result = await provider.createPayment({
      amountValue: '12.50',
      currency: 'EUR',
      description: 'Order CR-1001',
      orderId: 'order-uuid-1',
      redirectUrl: 'https://shop.example/checkout/return?order=CR-1001',
      webhookUrl: 'https://api.example/api/payments/mollie/webhook',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;

    // Endpoint + method + SAME host (test/live via key, not host).
    expect(call.url).toBe('https://api.mollie.com/v2/payments');
    expect(call.method).toBe('POST');

    // Auth = Bearer key; JSON content-type; per-request Idempotency-Key (uuid).
    expect(call.headers.Authorization).toBe('Bearer test_KEY_abc');
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.headers['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // Body shape: amount.value is a 2-dec STRING; metadata round-trips orderId.
    expect(call.body).toEqual({
      amount: { currency: 'EUR', value: '12.50' },
      description: 'Order CR-1001',
      redirectUrl: 'https://shop.example/checkout/return?order=CR-1001',
      webhookUrl: 'https://api.example/api/payments/mollie/webhook',
      metadata: { orderId: 'order-uuid-1' },
    });

    // Normalized result.
    expect(result.providerPaymentId).toBe('tr_test123');
    expect(result.checkoutUrl).toBe('https://www.mollie.com/checkout/tr_test123');
    expect(result.status).toBe('open');
  });

  it('uses a FRESH Idempotency-Key per call', async () => {
    const calls = installFetchMock(() => ({
      status: 201,
      json: { id: 'tr_x', status: 'open', _links: { checkout: { href: 'h' } } },
    }));
    const provider = new MollieProvider('test_KEY');
    const base = {
      currency: 'EUR',
      description: 'd',
      orderId: 'o',
      redirectUrl: 'https://r',
      webhookUrl: 'https://w',
    };
    await provider.createPayment({ ...base, amountValue: '1.00' });
    await provider.createPayment({ ...base, amountValue: '2.00' });
    expect(calls[0]!.headers['Idempotency-Key']).not.toBe(
      calls[1]!.headers['Idempotency-Key'],
    );
  });
});

// ─── getStatus / getPayment ───────────────────────────────────

describe('MollieProvider.getStatus / getPayment', () => {
  it('GETs /v2/payments/{id} with the Bearer key and maps status + metadata', async () => {
    const calls = installFetchMock(() => ({
      status: 200,
      json: { id: 'tr_abc', status: 'paid', metadata: { orderId: 'order-9' } },
    }));
    const provider = new MollieProvider('live_secret');

    const status = await provider.getStatus('tr_abc');
    expect(status).toBe('paid');

    const payment = await provider.getPayment('tr_abc');
    expect(payment.status).toBe('paid');
    expect(payment.orderId).toBe('order-9');

    expect(calls[0]!.url).toBe('https://api.mollie.com/v2/payments/tr_abc');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers.Authorization).toBe('Bearer live_secret');
  });
});

// ─── 429 backoff ──────────────────────────────────────────────

describe('MollieProvider rate-limit handling', () => {
  it('retries on 429 then succeeds', async () => {
    let n = 0;
    const calls = installFetchMock(() => {
      n += 1;
      if (n === 1) return { status: 429, headers: { 'retry-after': '0' } };
      return { status: 200, json: { id: 'tr_r', status: 'open' } };
    });
    const provider = new MollieProvider('test_k');
    const status = await provider.getStatus('tr_r');
    expect(status).toBe('open');
    expect(calls.length).toBe(2); // one 429 + one success
  });
});

// ─── error normalization ──────────────────────────────────────

describe('MollieProvider error normalization', () => {
  it('throws PaymentProviderError (with status) on a 4xx', async () => {
    installFetchMock(() => ({ status: 422, json: { detail: 'amount is invalid' } }));
    const provider = new MollieProvider('test_k');
    await expect(provider.getStatus('tr_bad')).rejects.toMatchObject({
      error: 'payment_provider_error',
      status: 422,
    });
  });
});

// ─── factory ──────────────────────────────────────────────────

describe('getPaymentProvider factory', () => {
  it('lists mollie as supported', () => {
    expect(SUPPORTED_PAYMENT_PROVIDERS).toContain('mollie');
  });

  it('returns null when the shop has NO provider (→ keep mock-paid)', () => {
    expect(getPaymentProvider({})).toBeNull();
    expect(getPaymentProvider({ paymentProvider: null })).toBeNull();
    expect(getPaymentProvider({ paymentProvider: '' })).toBeNull();
    expect(getPaymentProvider({ paymentProvider: '   ' })).toBeNull();
  });

  it('returns null for an unsupported provider key', () => {
    const enc = encryptCredentials({ apiKey: 'test_x' });
    expect(
      getPaymentProvider({ paymentProvider: 'stripe', paymentCredentials: enc }),
    ).toBeNull();
  });

  it('returns null when mollie is set but credentials are missing/empty', () => {
    expect(getPaymentProvider({ paymentProvider: 'mollie' })).toBeNull();
    expect(
      getPaymentProvider({ paymentProvider: 'mollie', paymentCredentials: null }),
    ).toBeNull();
    const emptyKey = encryptCredentials({ apiKey: '' });
    expect(
      getPaymentProvider({ paymentProvider: 'mollie', paymentCredentials: emptyKey }),
    ).toBeNull();
  });

  it('returns null when the credential blob is un-decryptable', () => {
    expect(
      getPaymentProvider({
        paymentProvider: 'mollie',
        paymentCredentials: { enc: 'corrupt-blob' },
      }),
    ).toBeNull();
  });

  it('returns a MollieProvider when configured with a valid encrypted key', () => {
    const enc = encryptCredentials({ apiKey: 'test_valid_KEY_123' });
    const provider = getPaymentProvider({
      paymentProvider: 'mollie',
      paymentCredentials: enc,
    });
    expect(provider).not.toBeNull();
    expect(provider!.provider).toBe('mollie');
    expect(provider instanceof MollieProvider).toBe(true);
    expect((provider as InstanceType<typeof MollieProvider>).isTestMode).toBe(true);
  });
});

// ─── not-connected type-guard ─────────────────────────────────

describe('isPaymentNotConnectedError', () => {
  it('recognises the typed error and the shape across realms', () => {
    expect(isPaymentNotConnectedError(new PaymentNotConnectedError('x'))).toBe(true);
    expect(isPaymentNotConnectedError({ error: 'channel_not_connected' })).toBe(true);
    expect(isPaymentNotConnectedError(new Error('other'))).toBe(false);
    expect(isPaymentNotConnectedError(null)).toBe(false);
  });
});
