/**
 * Unit-tests voor de Amazon SP-API adapter (Wave-H A2).
 *
 * Geen live netwerk: we injecteren een FAKE fetch (+ fake clock/sleep) in de
 * adapter en de SpApiClient en asserten de OFFICIËLE contract-details:
 *   - LWA token-body-constructie (grant_type/refresh_token/client_id/secret)
 *   - x-amz-access-token header (NOOIT Authorization: Bearer)
 *   - host per region + sandbox-toggle
 *   - path-versioned endpoints (/orders/v0/..., /listings/2021-08-01/...)
 *   - LWA token-cache (1 token-call voor meerdere requests)
 *   - RDT-flow voor buyer-PII (getOrders gebruikt de RDT als x-amz-access-token)
 *   - requireCreds-guards (geen fire zonder creds / status!=='connected')
 *   - 429 QuotaExceeded → backoff + retry, en error-normalisatie
 *   - normalizeOrder op een echte SP-API order-sample
 *
 * env vóór de dynamische import (zelfde patroon als channels.test.ts).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

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

const amazonMod = await import('../adapters/amazon.js');
const clientMod = await import('../adapters/_spapi-client.js');
const cryptoMod = await import('../../../lib/channel-crypto.js');
const types = await import('../adapters/types.js');

type Json = Record<string, unknown>;

/** A recorded fetch call. */
interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A scripted fake-fetch: routes by (method, url-substring) → {status, json}. */
function makeFetch(
  routes: Array<{
    match: (url: string, init: RequestInit) => boolean;
    status?: number;
    json?: Json;
    headers?: Record<string, string>;
  }>,
) {
  const calls: Recorded[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = normalizeHeaders(init.headers);
    calls.push({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init.body === 'string' ? init.body : undefined,
    });
    const route = routes.find((r) => r.match(url, init));
    const status = route?.status ?? 200;
    const payload = route?.json ?? {};
    const respHeaders = new Map(Object.entries(route?.headers ?? {}));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => respHeaders.get(n.toLowerCase()) ?? null },
      json: async () => payload,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function normalizeHeaders(h: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (Array.isArray(h)) for (const [k, v] of h) out[k.toLowerCase()] = v;
  else if (h instanceof Map) for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

/** Build a connected Amazon channel with encrypted creds. */
function makeChannel(
  creds: Record<string, unknown> | null,
  over: Record<string, unknown> = {},
) {
  const now = new Date('2026-06-01T10:00:00.000Z');
  return {
    id: '22222222-2222-2222-2222-222222222222',
    type: 'amazon',
    name: 'Amazon NL',
    status: 'connected',
    credentials: creds ? cryptoMod.encryptCredentials(creds) : null,
    config: {},
    lastSyncAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as unknown as import('../../../db/schema/channels.js').Channel;
}

const FULL_CREDS = {
  lwaClientId: 'amzn1.application-oa2-client.ABC',
  lwaClientSecret: 'lwa-secret-XYZ',
  refreshToken: 'Atzr|refresh-token-123',
  sellerId: 'A2SELLER99',
};

// ─────────────────────────────────────────────────────────────────────────────

describe('SpApiClient.buildTokenBody — exact LWA refresh_token grant', () => {
  it('builds grant_type=refresh_token with the 3 LWA fields', () => {
    const body = clientMod.SpApiClient.buildTokenBody({
      refreshToken: 'RT-1',
      lwaClientId: 'CID',
      lwaClientSecret: 'SEC',
    });
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('RT-1');
    expect(body.get('client_id')).toBe('CID');
    expect(body.get('client_secret')).toBe('SEC');
    // No stray fields.
    expect([...body.keys()].sort()).toEqual([
      'client_id',
      'client_secret',
      'grant_type',
      'refresh_token',
    ]);
  });
});

describe('SpApiClient — host by region + sandbox toggle', () => {
  function host(region: string, environment: 'sandbox' | 'production') {
    return new clientMod.SpApiClient(
      {
        lwaClientId: 'c',
        lwaClientSecret: 's',
        refreshToken: 'r',
        marketplaceId: clientMod.DEFAULT_MARKETPLACE_ID,
        region,
        environment,
      },
      {},
    ).host;
  }
  it('eu/production → sellingpartnerapi-eu', () => {
    expect(host('eu', 'production')).toBe('https://sellingpartnerapi-eu.amazon.com');
  });
  it('na/production → sellingpartnerapi-na', () => {
    expect(host('na', 'production')).toBe('https://sellingpartnerapi-na.amazon.com');
  });
  it('fe/production → sellingpartnerapi-fe', () => {
    expect(host('fe', 'production')).toBe('https://sellingpartnerapi-fe.amazon.com');
  });
  it('eu/sandbox → sandbox.sellingpartnerapi-eu', () => {
    expect(host('eu', 'sandbox')).toBe('https://sandbox.sellingpartnerapi-eu.amazon.com');
  });
  it('unknown region falls back to eu', () => {
    expect(host('zz', 'production')).toBe('https://sellingpartnerapi-eu.amazon.com');
  });
});

describe('SpApiClient — token cache + x-amz-access-token header', () => {
  it('caches the LWA token for 1h and re-uses it across requests', async () => {
    let clock = 1_000_000;
    const { impl, calls } = makeFetch([
      {
        match: (u) => u.includes('/auth/o2/token'),
        json: { access_token: 'ACCESS-1', expires_in: 3600 },
      },
      { match: (u) => u.includes('/orders/v0/orders'), json: { payload: { Orders: [] } } },
    ]);
    const client = new clientMod.SpApiClient(
      {
        lwaClientId: 'c',
        lwaClientSecret: 's',
        refreshToken: 'r',
        marketplaceId: clientMod.DEFAULT_MARKETPLACE_ID,
        region: 'eu',
        environment: 'production',
      },
      { fetchImpl: impl, now: () => clock, sleep: async () => {} },
    );

    await client.request('getOrders', { method: 'GET', path: '/orders/v0/orders' });
    await client.request('getOrders', { method: 'GET', path: '/orders/v0/orders' });

    const tokenCalls = calls.filter((c) => c.url.includes('/auth/o2/token'));
    expect(tokenCalls).toHaveLength(1); // cached on 2nd request

    // LWA token call is x-www-form-urlencoded with the right body.
    expect(tokenCalls[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(tokenCalls[0]!.body).toContain('grant_type=refresh_token');

    // Resource call uses x-amz-access-token, NOT Authorization: Bearer.
    const orderCall = calls.find((c) => c.url.includes('/orders/v0/orders'))!;
    expect(orderCall.headers['x-amz-access-token']).toBe('ACCESS-1');
    expect(orderCall.headers['authorization']).toBeUndefined();
  });

  it('refreshes the token ~60s before expiry', async () => {
    let clock = 0;
    let tokenIdx = 0;
    const { impl, calls } = makeFetch([
      {
        match: (u) => u.includes('/auth/o2/token'),
        json: {},
      },
    ]);
    // Vary token per call.
    const impl2 = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes('/auth/o2/token')) {
        tokenIdx += 1;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ access_token: `ACCESS-${tokenIdx}`, expires_in: 3600 }),
        } as unknown as Response;
      }
      return impl(input, init);
    }) as unknown as typeof fetch;

    const client = new clientMod.SpApiClient(
      {
        lwaClientId: 'c',
        lwaClientSecret: 's',
        refreshToken: 'r',
        marketplaceId: clientMod.DEFAULT_MARKETPLACE_ID,
        region: 'eu',
        environment: 'production',
      },
      { fetchImpl: impl2, now: () => clock, sleep: async () => {} },
    );
    const t1 = await client.getAccessToken();
    expect(t1).toBe('ACCESS-1');
    // Advance to 5s before expiry → within the 60s skew → refresh.
    clock = 3600_000 - 5_000;
    const t2 = await client.getAccessToken();
    expect(t2).toBe('ACCESS-2');
    expect(calls).toHaveLength(0); // (calls array is for the order route; unused here)
  });
});

describe('SpApiClient — 429 QuotaExceeded backoff + error normalization', () => {
  it('retries on 429 then succeeds, and normalizes a final hard error', async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const impl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/auth/o2/token')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ access_token: 'A', expires_in: 3600 }),
        } as unknown as Response;
      }
      attempts += 1;
      if (attempts < 3) {
        return {
          ok: false,
          status: 429,
          headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? '0' : null) },
          json: async () => ({ errors: [{ code: 'QuotaExceeded', message: 'slow down' }] }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ payload: { Orders: [] } }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = new clientMod.SpApiClient(
      {
        lwaClientId: 'c',
        lwaClientSecret: 's',
        refreshToken: 'r',
        marketplaceId: clientMod.DEFAULT_MARKETPLACE_ID,
        region: 'eu',
        environment: 'production',
      },
      { fetchImpl: impl, now: () => Date.now(), sleep: async (ms) => { sleeps.push(ms); }, maxRetries: 4 },
    );
    const res = await client.request<{ payload: { Orders: unknown[] } }>('getOrders', {
      method: 'GET',
      path: '/orders/v0/orders',
    });
    expect(res.payload.Orders).toEqual([]);
    expect(attempts).toBe(3); // two 429s then success
    expect(sleeps.length).toBe(2); // two backoff waits
  });

  it('throws a normalized SpApiError on a non-retryable 400', async () => {
    const impl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/auth/o2/token')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ access_token: 'A', expires_in: 3600 }),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 400,
        headers: { get: () => null },
        json: async () => ({ errors: [{ code: 'InvalidInput', message: 'bad param' }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const client = new clientMod.SpApiClient(
      {
        lwaClientId: 'c',
        lwaClientSecret: 's',
        refreshToken: 'r',
        marketplaceId: clientMod.DEFAULT_MARKETPLACE_ID,
        region: 'eu',
        environment: 'production',
      },
      { fetchImpl: impl, now: () => Date.now(), sleep: async () => {} },
    );
    await expect(
      client.request('getOrders', { method: 'GET', path: '/orders/v0/orders' }),
    ).rejects.toMatchObject({ name: 'SpApiError', code: 'InvalidInput', status: 400 });
  });

  it('normalizeSpApiError flattens the LWA invalid_grant shape', () => {
    const err = clientMod.normalizeSpApiError(
      400,
      { error: 'invalid_grant', error_description: 'refresh token expired' },
      'lwaToken',
    );
    expect(err.code).toBe('invalid_grant');
    expect(err.message).toBe('refresh token expired');
    expect(err.isRateLimit).toBe(false);
  });
});

describe('AmazonAdapter — requireCreds guards (no live fire)', () => {
  it('verifyConnection returns credentials-required when not connected', async () => {
    const adapter = new amazonMod.AmazonAdapter();
    const ch = makeChannel(null, { status: 'disconnected' });
    const r = await adapter.verifyConnection(ch);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('Amazon credentials required');
  });

  it('verifyConnection returns credentials-required when connected but creds empty', async () => {
    const adapter = new amazonMod.AmazonAdapter();
    const ch = makeChannel(null, { status: 'connected' });
    const r = await adapter.verifyConnection(ch);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('Amazon credentials required');
  });

  it('fetchOrders throws a typed channel_not_connected when not connected', async () => {
    const adapter = new amazonMod.AmazonAdapter();
    const ch = makeChannel(null, { status: 'disconnected' });
    await expect(adapter.fetchOrders(ch)).rejects.toSatisfy((e) =>
      types.isChannelNotConnectedError(e),
    );
  });

  it('updateInventory throws channel_not_connected when creds missing', async () => {
    const adapter = new amazonMod.AmazonAdapter();
    const ch = makeChannel({ lwaClientId: 'only-id' }, { status: 'connected' });
    await expect(adapter.updateInventory(ch, 'SKU-1', 5)).rejects.toSatisfy((e) =>
      types.isChannelNotConnectedError(e),
    );
  });
});

describe('AmazonAdapter — verifyConnection happy path + region/env label', () => {
  it('connected → fetches an LWA token and reports region/env', async () => {
    const { impl, calls } = makeFetch([
      {
        match: (u) => u.includes('/auth/o2/token'),
        json: { access_token: 'ACCESS-OK', expires_in: 3600 },
      },
    ]);
    const adapter = new amazonMod.AmazonAdapter({
      fetchImpl: impl,
      now: () => Date.now(),
      sleep: async () => {},
    });
    const ch = makeChannel(FULL_CREDS, { config: { region: 'eu', environment: 'sandbox' } });
    const r = await adapter.verifyConnection(ch);
    expect(r.ok).toBe(true);
    expect(r.detail).toBe('Amazon SP-API (eu/sandbox) verbonden');
    // Exactly one token call, no resource call.
    expect(calls.filter((c) => c.url.includes('/auth/o2/token'))).toHaveLength(1);
  });
});

describe('AmazonAdapter — fetchOrders: RDT + path-versioned endpoints + pagination', () => {
  it('mints an RDT, pages orders, fetches orderItems, normalizes', async () => {
    const sampleOrder = {
      AmazonOrderId: '123-4567890-1234567',
      PurchaseDate: '2026-05-30T08:00:00Z',
      OrderTotal: { CurrencyCode: 'EUR', Amount: '49.98' },
      BuyerInfo: { BuyerEmail: 'buyer@marketplace.amazon.nl' },
    };
    const sampleItems = [
      {
        SellerSKU: 'SKU-RED-M',
        Title: 'Red Shirt M',
        QuantityOrdered: 2,
        ItemPrice: { CurrencyCode: 'EUR', Amount: '49.98' },
        ItemTax: { CurrencyCode: 'EUR', Amount: '8.68' },
      },
    ];

    let ordersCall = 0;
    const { impl, calls } = makeFetch([
      {
        match: (u) => u.includes('/auth/o2/token'),
        json: { access_token: 'ACCESS-LWA', expires_in: 3600 },
      },
      {
        match: (u) => u.includes('/tokens/2021-03-01/restrictedDataToken'),
        json: { restrictedDataToken: 'RDT-PII-999' },
      },
      {
        match: (u, init) =>
          u.includes('/orders/v0/orders') &&
          !u.includes('orderItems') &&
          (init.method ?? 'GET').toUpperCase() === 'GET',
        json: {}, // overridden below via custom impl
      },
    ]);

    // Custom impl to script 2-page pagination + items.
    const impl2 = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      const method = (init.method ?? 'GET').toUpperCase();
      if (url.includes('/auth/o2/token')) {
        return resp(200, { access_token: 'ACCESS-LWA', expires_in: 3600 });
      }
      if (url.includes('/tokens/2021-03-01/restrictedDataToken')) {
        return resp(200, { restrictedDataToken: 'RDT-PII-999' });
      }
      if (url.includes('/orderItems')) {
        return resp(200, { payload: { OrderItems: sampleItems } });
      }
      if (url.includes('/orders/v0/orders') && method === 'GET') {
        ordersCall += 1;
        if (ordersCall === 1) {
          return resp(200, { payload: { Orders: [sampleOrder], NextToken: 'PAGE2' } });
        }
        return resp(200, { payload: { Orders: [] } });
      }
      return resp(404, {});
      function resp(status: number, json: Json) {
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: () => null },
          json: async () => json,
        } as unknown as Response;
      }
    }) as unknown as typeof fetch;

    // Use impl2 (the makeFetch `calls` array is unused for assertions here; we
    // re-record on impl2 manually).
    const recorded: Recorded[] = [];
    const recImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
      recorded.push({
        url: String(input),
        method: (init.method ?? 'GET').toUpperCase(),
        headers: normalizeHeaders(init.headers),
        body: typeof init.body === 'string' ? init.body : undefined,
      });
      return impl2(input, init);
    }) as unknown as typeof fetch;
    void impl;
    void calls;

    const adapter = new amazonMod.AmazonAdapter({
      fetchImpl: recImpl,
      now: () => Date.now(),
      sleep: async () => {},
    });
    const ch = makeChannel(FULL_CREDS);
    const orders = await adapter.fetchOrders(ch);

    // Normalized order.
    expect(orders).toHaveLength(1);
    const o = orders[0]!;
    expect(o.externalId).toBe('123-4567890-1234567');
    expect(o.channelType).toBe('amazon');
    expect(o.currency).toBe('EUR');
    expect(o.email).toBe('buyer@marketplace.amazon.nl');
    expect(o.items).toHaveLength(1);
    // ItemPrice is a line total (49.98 for qty 2) → per-unit 24.99.
    expect(o.items[0]!.unitPrice).toBe('24.9900');
    expect(o.items[0]!.sku).toBe('SKU-RED-M');
    expect(o.items[0]!.quantity).toBe(2);

    // RDT was minted and used as x-amz-access-token on the getOrders calls.
    const rdtMint = recorded.find((c) => c.url.includes('/restrictedDataToken'));
    expect(rdtMint).toBeTruthy();
    const orderListCalls = recorded.filter(
      (c) => c.url.includes('/orders/v0/orders') && !c.url.includes('orderItems'),
    );
    expect(orderListCalls.length).toBe(2); // page1 + page2 (NextToken)
    for (const c of orderListCalls) {
      expect(c.headers['x-amz-access-token']).toBe('RDT-PII-999');
      expect(c.headers['authorization']).toBeUndefined();
    }
    // Page 2 carried the NextToken.
    expect(orderListCalls[1]!.url).toContain('NextToken=PAGE2');
    // CreatedAfter only on page 1.
    expect(orderListCalls[0]!.url).toContain('CreatedAfter=');

    // orderItems used the plain LWA token (not the RDT), version-pathed.
    const itemsCall = recorded.find((c) => c.url.includes('/orderItems'))!;
    expect(itemsCall.url).toContain('/orders/v0/orders/');
    expect(itemsCall.headers['x-amz-access-token']).toBe('ACCESS-LWA');
  });
});

describe('AmazonAdapter — updateInventory: PATCH on version-pathed listings', () => {
  it('PATCHes fulfillment_availability/quantity at /listings/2021-08-01/items/{sellerId}/{sku}', async () => {
    const recorded: Recorded[] = [];
    const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      recorded.push({
        url,
        method: (init.method ?? 'GET').toUpperCase(),
        headers: normalizeHeaders(init.headers),
        body: typeof init.body === 'string' ? init.body : undefined,
      });
      if (url.includes('/auth/o2/token')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ access_token: 'ACCESS-LWA', expires_in: 3600 }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const adapter = new amazonMod.AmazonAdapter({
      fetchImpl: impl,
      now: () => Date.now(),
      sleep: async () => {},
    });
    const ch = makeChannel(FULL_CREDS);
    await adapter.updateInventory(ch, 'SKU-RED-M', 7);

    const patch = recorded.find((c) => c.method === 'PATCH')!;
    expect(patch).toBeTruthy();
    expect(patch.url).toContain('/listings/2021-08-01/items/A2SELLER99/SKU-RED-M');
    expect(patch.url).toContain(`marketplaceIds=${clientMod.DEFAULT_MARKETPLACE_ID}`);
    expect(patch.headers['x-amz-access-token']).toBe('ACCESS-LWA');
    expect(patch.headers['authorization']).toBeUndefined();
    const body = JSON.parse(patch.body!);
    expect(body.patches[0].path).toBe('/attributes/fulfillment_availability');
    expect(body.patches[0].value[0].quantity).toBe(7);
  });
});

describe('AmazonAdapter — normalizeOrder on a raw SP-API sample', () => {
  it('maps AmazonOrderId, currency, email, and per-unit item price', () => {
    const adapter = new amazonMod.AmazonAdapter();
    const raw = {
      AmazonOrderId: '999-1112223-3334445',
      PurchaseDate: '2026-05-29T12:34:56Z',
      OrderTotal: { CurrencyCode: 'EUR', Amount: '30.00' },
      BuyerInfo: { BuyerEmail: 'x@amazon.nl' },
      OrderItems: [
        {
          SellerSKU: 'SKU-A',
          Title: 'Item A',
          QuantityOrdered: 3,
          ItemPrice: { Amount: '30.00' },
        },
      ],
    };
    const n = adapter.normalizeOrder(raw);
    expect(n.externalId).toBe('999-1112223-3334445');
    expect(n.channelType).toBe('amazon');
    expect(n.currency).toBe('EUR');
    expect(n.email).toBe('x@amazon.nl');
    expect(n.placedAt).toBe('2026-05-29T12:34:56Z');
    expect(n.items[0]!.unitPrice).toBe('10.0000'); // 30.00 / 3
    expect(n.items[0]!.quantity).toBe(3);
    expect(n.raw).toBe(raw);
  });

  it('handles a missing-items / minimal order without throwing', () => {
    const adapter = new amazonMod.AmazonAdapter();
    const n = adapter.normalizeOrder({ AmazonOrderId: 'A1' });
    expect(n.externalId).toBe('A1');
    expect(n.items).toEqual([]);
    expect(n.currency).toBe('EUR');
    expect(n.email).toBeNull();
  });
});

describe('AmazonAdapter — MARKETPLACES map is exported with NL default', () => {
  it('exposes NL/DE/FR/BE and DEFAULT_MARKETPLACE_ID is NL', () => {
    expect(amazonMod.MARKETPLACES.NL!.id).toBe('A1805IZSGTT6HS');
    expect(amazonMod.MARKETPLACES.DE).toBeTruthy();
    expect(amazonMod.MARKETPLACES.FR).toBeTruthy();
    expect(amazonMod.MARKETPLACES.BE).toBeTruthy();
    expect(clientMod.DEFAULT_MARKETPLACE_ID).toBe('A1805IZSGTT6HS');
  });
  it('reports the official credential field names', () => {
    expect(amazonMod.AMAZON_CREDENTIAL_FIELDS).toEqual([
      'lwaClientId',
      'lwaClientSecret',
      'refreshToken',
      'sellerId',
      'marketplaceIds',
      'region',
      'environment',
    ]);
  });
});

// Keep vi import referenced even if a future test stubs timers.
void vi;
