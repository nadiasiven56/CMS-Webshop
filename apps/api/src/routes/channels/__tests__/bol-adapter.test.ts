/**
 * Unit-tests for the bol.com Retailer API v10 adapter + its low-level client.
 *
 * These are pure, offline tests: NO live network, NO DB. We assert the OFFICIAL
 * contract pieces a turnkey integration must get exactly right BEFORE real keys
 * exist — and that nothing fires without credentials:
 *
 *   - OAuth `Basic base64(clientId:clientSecret)` header construction.
 *   - v10 media-type headers (Accept + Content-Type only when a body is sent).
 *   - base URL by config.environment (demo default, production opt-in).
 *   - requireCreds guards: bol with no/empty creds throws 'Bol credentials
 *     required' (typed channel_not_connected) and verifyConnection returns
 *     {ok:false} WITHOUT any network call.
 *   - normalizeOrder mapping a sample bol order JSON → NormalizedOrder.
 *   - in-memory token caching (one token fetch for many calls).
 *   - fetchOrders pagination + per-order item GET.
 *   - 429 Retry-After backoff.
 *   - async ProcessStatus polling until !=PENDING.
 *
 * env is set before the dynamic imports so `env.js` validates (same pattern as
 * channels.test.ts / channel-crypto.test.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

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

const bolMod = await import('../adapters/bol.js');
const clientMod = await import('../adapters/_bol-client.js');
const cryptoMod = await import('../../../lib/channel-crypto.js');
const types = await import('../adapters/types.js');

type Channel = import('../../../db/schema/channels.js').Channel;

/** Build a minimal Channel row. */
function makeChannel(over: Record<string, unknown> = {}): Channel {
  const now = new Date('2026-06-01T10:00:00.000Z');
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    type: 'bol',
    name: 'Bol.com',
    status: 'disconnected',
    credentials: null,
    config: {},
    lastSyncAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as unknown as Channel;
}

/** A connected bol channel with encrypted creds + chosen environment. */
function connectedChannel(
  environment: 'demo' | 'production' = 'demo',
  creds = { clientId: 'cid-123', clientSecret: 'csecret-xyz' },
  over: Record<string, unknown> = {},
): Channel {
  return makeChannel({
    status: 'connected',
    credentials: cryptoMod.encryptCredentials(creds),
    config: { environment },
    ...over,
  });
}

/**
 * Tiny fetch-mock builder: enqueue (status, json|text, headers) responses and
 * record every request. Returns a fetch-compatible fn.
 */
function makeFetchMock(
  queue: Array<{
    status?: number;
    json?: unknown;
    text?: string;
    headers?: Record<string, string>;
  }>,
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift() ?? { status: 200, json: {} };
    const status = next.status ?? 200;
    const bodyText =
      next.text !== undefined
        ? next.text
        : next.json !== undefined
          ? JSON.stringify(next.json)
          : '';
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      headers: { get: (k: string) => next.headers?.[k.toLowerCase()] ?? null },
      async text() {
        return bodyText;
      },
      async json() {
        return JSON.parse(bodyText);
      },
    } as unknown as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

beforeEach(() => {
  clientMod.clearBolTokenCache();
});

// ─── Low-level client primitives ─────────────────────────────

describe('_bol-client primitives', () => {
  it('buildBasicAuthHeader = Basic base64(clientId:clientSecret)', () => {
    const header = clientMod.buildBasicAuthHeader('cid-123', 'csecret-xyz');
    const expected = `Basic ${Buffer.from('cid-123:csecret-xyz', 'utf8').toString('base64')}`;
    expect(header).toBe(expected);
    // Round-trip decode proves the exact colon-joined plaintext.
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    expect(decoded).toBe('cid-123:csecret-xyz');
  });

  it('bolResourceHeaders sets the v10 media type; Content-Type only with a body', () => {
    const noBody = clientMod.bolResourceHeaders('JWT', false);
    expect(noBody.Authorization).toBe('Bearer JWT');
    expect(noBody.Accept).toBe('application/vnd.retailer.v10+json');
    expect(noBody['Content-Type']).toBeUndefined();

    const withBody = clientMod.bolResourceHeaders('JWT', true);
    expect(withBody.Accept).toBe('application/vnd.retailer.v10+json');
    expect(withBody['Content-Type']).toBe('application/vnd.retailer.v10+json');
  });

  it('bolApiBaseUrl: demo by default, production opt-in', () => {
    expect(clientMod.bolApiBaseUrl('demo')).toBe('https://api.bol.com/retailer-demo');
    expect(clientMod.bolApiBaseUrl('production')).toBe('https://api.bol.com/retailer');
  });

  it('getToken posts the form grant with Basic auth + caches the JWT', async () => {
    const { fn, calls } = makeFetchMock([
      { json: { access_token: 'JWT-1', expires_in: 299 } },
    ]);
    const client = new clientMod.BolClient({
      clientId: 'cid-123',
      clientSecret: 'csecret-xyz',
      environment: 'demo',
      cacheKey: 'chan-1',
      fetchImpl: fn,
    });
    const t1 = await client.getToken();
    const t2 = await client.getToken();
    expect(t1).toBe('JWT-1');
    expect(t2).toBe('JWT-1');
    // Cached: only ONE token request despite two getToken calls.
    expect(calls).toHaveLength(1);
    const tokenCall = calls[0]!;
    expect(tokenCall.url).toBe('https://login.bol.com/token');
    expect(tokenCall.init.method).toBe('POST');
    expect(tokenCall.init.body).toBe('grant_type=client_credentials');
    const headers = tokenCall.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      clientMod.buildBasicAuthHeader('cid-123', 'csecret-xyz'),
    );
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('refetches a fresh token once the cached one is within the expiry skew', async () => {
    const { fn, calls } = makeFetchMock([
      { json: { access_token: 'JWT-A', expires_in: 299 } },
      { json: { access_token: 'JWT-B', expires_in: 299 } },
    ]);
    let nowMs = 1_000_000;
    const client = new clientMod.BolClient({
      clientId: 'cid-123',
      clientSecret: 'csecret-xyz',
      environment: 'demo',
      cacheKey: 'chan-skew',
      fetchImpl: fn,
      now: () => nowMs,
    });
    expect(await client.getToken()).toBe('JWT-A');
    // Advance past (expires_in - 30s skew) so the cache is stale.
    nowMs += 280 * 1000;
    expect(await client.getToken()).toBe('JWT-B');
    expect(calls).toHaveLength(2);
  });

  it('request() honours Retry-After on 429 then succeeds', async () => {
    const sleeps: number[] = [];
    const { fn, calls } = makeFetchMock([
      { json: { access_token: 'JWT', expires_in: 299 } },
      { status: 429, headers: { 'retry-after': '2' }, text: '' },
      { status: 200, json: { ok: true } },
    ]);
    const client = new clientMod.BolClient({
      clientId: 'c',
      clientSecret: 's',
      environment: 'demo',
      cacheKey: 'chan-429',
      fetchImpl: fn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const res = await client.request<{ ok: boolean }>('/ping');
    expect(res.ok).toBe(true);
    expect(sleeps).toEqual([2000]); // Retry-After: 2s → 2000ms backoff
    // token + first(429) + retry(200) = 3 fetches
    expect(calls).toHaveLength(3);
  });

  it('request() normalizes a vendor error body to a typed BolApiError', async () => {
    const { fn } = makeFetchMock([
      { json: { access_token: 'JWT', expires_in: 299 } },
      {
        status: 400,
        json: {
          type: 'https://api.bol.com/problems',
          title: 'Bad offer',
          violations: [{ name: 'amount', reason: 'must be >= 0' }],
        },
      },
    ]);
    const client = new clientMod.BolClient({
      clientId: 'c',
      clientSecret: 's',
      environment: 'demo',
      cacheKey: 'chan-err',
      fetchImpl: fn,
    });
    await expect(client.request('/offers/x/stock', { method: 'PUT', body: {} })).rejects.toSatisfy(
      (e: unknown) =>
        clientMod.isBolApiError(e) &&
        (e as InstanceType<typeof clientMod.BolApiError>).httpStatus === 400 &&
        (e as InstanceType<typeof clientMod.BolApiError>).message === 'Bad offer',
    );
  });

  it('pollProcessStatus loops on PENDING until SUCCESS', async () => {
    const { fn } = makeFetchMock([
      { json: { access_token: 'JWT', expires_in: 299 } },
      { json: { processStatusId: 'ps-1', status: 'PENDING' } },
      { json: { processStatusId: 'ps-1', status: 'PENDING' } },
      { json: { processStatusId: 'ps-1', status: 'SUCCESS', entityId: 'ent-9' } },
    ]);
    const client = new clientMod.BolClient({
      clientId: 'c',
      clientSecret: 's',
      environment: 'demo',
      cacheKey: 'chan-poll',
      fetchImpl: fn,
      sleep: async () => {},
    });
    const final = await client.pollProcessStatus('ps-1');
    expect(final.status).toBe('SUCCESS');
    expect(final.entityId).toBe('ent-9');
  });
});

// ─── Adapter guards (READY UP TO THE KEY-ENTRY POINT) ────────

describe('BolAdapter requireCreds guards — nothing fires without creds', () => {
  it('verifyConnection returns credentials-required when disconnected (no fetch)', async () => {
    const ch = makeChannel({ status: 'disconnected', credentials: null });
    const r = await bolMod.bolAdapter.verifyConnection(ch);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('Bol credentials required');
  });

  it('verifyConnection reports not-connected when status=connected but creds empty', async () => {
    const ch = makeChannel({ status: 'connected', credentials: null });
    const r = await bolMod.bolAdapter.verifyConnection(ch);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('Bol credentials required');
  });

  it('fetchOrders throws typed channel_not_connected when not connected', async () => {
    const ch = makeChannel({ status: 'disconnected', credentials: null });
    await expect(bolMod.bolAdapter.fetchOrders(ch)).rejects.toSatisfy((e) =>
      types.isChannelNotConnectedError(e),
    );
  });

  it('submitShipment throws "Bol credentials required" when not connected', async () => {
    const ch = makeChannel({ status: 'disconnected', credentials: null });
    await expect(
      bolMod.bolAdapter.submitShipment(ch, 'order-1', { carrier: 'TNT' }),
    ).rejects.toThrow('Bol credentials required');
  });

  it('updateInventory + pushListing throw channel_not_connected when not connected', async () => {
    const ch = makeChannel({ status: 'disconnected', credentials: null });
    await expect(bolMod.bolAdapter.updateInventory(ch, 'offer-1', 5)).rejects.toSatisfy(
      (e) => types.isChannelNotConnectedError(e),
    );
    await expect(
      bolMod.bolAdapter.pushListing(ch, {
        variantId: 'v1',
        productId: 'p1',
        sku: 'SKU1',
        price: '19.9900',
        enabled: true,
      }),
    ).rejects.toSatisfy((e) => types.isChannelNotConnectedError(e));
  });
});

// ─── Environment selection ───────────────────────────────────

describe('BolAdapter environment by config', () => {
  it('defaults to the demo base URL', () => {
    expect(bolMod.bolAdapter.baseUrlFor(connectedChannel('demo'))).toBe(
      'https://api.bol.com/retailer-demo',
    );
    // No environment set at all → still demo.
    const noEnv = makeChannel({ status: 'connected', config: {} });
    expect(bolMod.bolAdapter.baseUrlFor(noEnv)).toBe(
      'https://api.bol.com/retailer-demo',
    );
  });

  it('uses production base URL only when config.environment=production', () => {
    expect(bolMod.bolAdapter.baseUrlFor(connectedChannel('production'))).toBe(
      'https://api.bol.com/retailer',
    );
  });
});

// ─── normalizeOrder ──────────────────────────────────────────

describe('BolAdapter.normalizeOrder', () => {
  it('maps a sample bol v10 order JSON to NormalizedOrder', () => {
    const sample = {
      orderId: '2306789012',
      orderPlacedDateTime: '2026-06-01T08:15:30+02:00',
      orderItems: [
        {
          orderItemId: 'item-A',
          quantity: 2,
          unitPrice: 24.99,
          product: { ean: '8712345678901', title: 'Wireless Earbuds' },
        },
        {
          orderItemId: 'item-B',
          quantity: 1,
          unitPrice: 9.5,
          product: { ean: '8712345678918', title: 'USB-C Cable' },
        },
      ],
    };
    const n = bolMod.bolAdapter.normalizeOrder(sample);
    expect(n.externalId).toBe('2306789012');
    expect(n.channelType).toBe('bol');
    expect(n.email).toBeNull(); // bol anonymizes buyer e-mail
    expect(n.currency).toBe('EUR');
    expect(n.placedAt).toBe('2026-06-01T08:15:30+02:00');
    expect(n.items).toHaveLength(2);
    expect(n.items[0]).toMatchObject({
      sku: '8712345678901',
      title: 'Wireless Earbuds',
      quantity: 2,
      unitPrice: '24.99', // money STRING, not a float
      taxRate: null,
      costPrice: null,
    });
    expect(n.items[1]!.unitPrice).toBe('9.5');
    expect(n.raw).toBe(sample); // raw kept verbatim for audit
  });

  it('tolerates a thin/empty order (no items)', () => {
    const n = bolMod.bolAdapter.normalizeOrder({ orderId: 'X' });
    expect(n.externalId).toBe('X');
    expect(n.items).toEqual([]);
  });
});

// ─── End-to-end orders flow (mocked transport) ──────────────

describe('BolAdapter.fetchOrders pagination + per-order item GET', () => {
  it('paginates the order list then fetches each order detail', async () => {
    const { fn, calls } = makeFetchMock([
      { json: { access_token: 'JWT', expires_in: 299 } }, // token
      { json: { orders: [{ orderId: 'O1' }, { orderId: 'O2' }] } }, // page 1
      { json: { orders: [] } }, // page 2 (empty → stop)
      {
        json: {
          orderId: 'O1',
          orderItems: [{ orderItemId: 'i1', quantity: 1, product: { ean: 'E1' } }],
        },
      },
      {
        json: {
          orderId: 'O2',
          orderItems: [{ orderItemId: 'i2', quantity: 3, product: { ean: 'E2' } }],
        },
      },
    ]);
    // Inject the mock fetch via the client by patching global fetch for this test.
    const realFetch = globalThis.fetch;
    globalThis.fetch = fn;
    try {
      const ch = connectedChannel('demo');
      const orders = await bolMod.bolAdapter.fetchOrders(ch);
      expect(orders.map((o) => o.externalId)).toEqual(['O1', 'O2']);
      expect(orders[0]!.items[0]!.sku).toBe('E1');
      expect(orders[1]!.items[0]!.quantity).toBe(3);

      // Assert the v10 query params + demo base URL were used on the list call.
      const listCall = calls.find((c) => c.url.includes('/orders?'));
      expect(listCall).toBeDefined();
      expect(listCall!.url).toContain('https://api.bol.com/retailer-demo/orders');
      expect(listCall!.url).toContain('status=OPEN');
      expect(listCall!.url).toContain('fulfilment-method=FBR');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
