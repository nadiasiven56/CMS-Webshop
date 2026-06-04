/**
 * Unit-tests voor de channels-module — schema-validatie, masked-serialisatie,
 * en adapter-guard-gedrag. GEEN live DB / geen gemount route (de route is nog
 * niet in routes/index.ts gewired; de finalizer doet dat). We dekken daarom:
 *
 *   - create / patch / credentials schema-validatie (zod)
 *   - serialize: credentials worden GEMASKEERD (nooit raw) + counts in detail
 *   - test-connection-paden: own_webshop OK (geen creds nodig), bol/amazon
 *     geven channel_not_connected wanneer status!=='connected'
 *   - credentials-roundtrip: encrypt → opslaan-shape → decrypt → mask
 *
 * env wordt vóór de dynamische import gezet zodat `env.js` valideert
 * (zelfde patroon als lib/__tests__/channel-crypto.test.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest';

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

const schemas = await import('../_schemas.js');
const serialize = await import('../_serialize.js');
const crypto = await import('../../../lib/channel-crypto.js');
const registry = await import('../adapters/index.js');
const bolMod = await import('../adapters/bol.js');
const amazonMod = await import('../adapters/amazon.js');
const ownMod = await import('../adapters/own-webshop.js');
const types = await import('../adapters/types.js');

/** Bouw een minimale Channel-row voor adapter/serializer-tests. */
function makeChannel(over: Record<string, unknown> = {}) {
  const now = new Date('2026-06-01T10:00:00.000Z');
  return {
    id: '11111111-1111-1111-1111-111111111111',
    type: 'bol',
    name: 'Bol.com',
    status: 'disconnected',
    credentials: null,
    config: {},
    lastSyncAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as unknown as import('../../../db/schema/channels.js').Channel;
}

describe('channels _schemas', () => {
  it('ChannelCreateSchema accepts a valid create body', () => {
    const r = schemas.ChannelCreateSchema.safeParse({
      type: 'bol',
      name: 'Bol.com NL',
      config: { foo: 'bar' },
    });
    expect(r.success).toBe(true);
  });

  it('ChannelCreateSchema rejects an unknown type', () => {
    const r = schemas.ChannelCreateSchema.safeParse({ type: 'ebay', name: 'x' });
    expect(r.success).toBe(false);
  });

  it('ChannelPatchSchema requires at least one field', () => {
    expect(schemas.ChannelPatchSchema.safeParse({}).success).toBe(false);
    expect(schemas.ChannelPatchSchema.safeParse({ name: 'New' }).success).toBe(true);
    expect(schemas.ChannelPatchSchema.safeParse({ status: 'connected' }).success).toBe(true);
    expect(schemas.ChannelPatchSchema.safeParse({ status: 'bogus' }).success).toBe(false);
  });

  it('bol credentials schema requires clientId + clientSecret', () => {
    const schema = schemas.CREDENTIALS_SCHEMA_BY_TYPE.bol!;
    expect(schema.safeParse({ clientId: 'a', clientSecret: 'b' }).success).toBe(true);
    expect(schema.safeParse({ clientId: 'a' }).success).toBe(false);
  });

  it('amazon credentials schema requires the 3 LWA fields', () => {
    const schema = schemas.CREDENTIALS_SCHEMA_BY_TYPE.amazon!;
    expect(
      schema.safeParse({ refreshToken: 'r', clientId: 'c', clientSecret: 's' }).success,
    ).toBe(true);
    expect(schema.safeParse({ clientId: 'c', clientSecret: 's' }).success).toBe(false);
  });

  it('own_webshop has no credentials schema', () => {
    expect(schemas.CREDENTIALS_SCHEMA_BY_TYPE.own_webshop).toBeNull();
  });

  it('ChannelProductUpsertSchema validates money + requires a field', () => {
    expect(schemas.ChannelProductUpsertSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(
      schemas.ChannelProductUpsertSchema.safeParse({ priceOverride: '19.9900' }).success,
    ).toBe(true);
    expect(
      schemas.ChannelProductUpsertSchema.safeParse({ priceOverride: '19.99999' }).success,
    ).toBe(false);
    expect(schemas.ChannelProductUpsertSchema.safeParse({}).success).toBe(false);
  });
});

describe('channels _serialize — credentials are masked, never raw', () => {
  it('toChannelDetailDto masks stored credentials + includes counts', () => {
    const encrypted = crypto.encryptCredentials({
      clientId: 'bol-client-123',
      clientSecret: 'super-secret-XYZ',
    });
    const ch = makeChannel({ status: 'connected', credentials: encrypted });
    const dto = serialize.toChannelDetailDto(ch, { products: 3, orders: 7 });

    // Presence-map only.
    expect(dto.credentials).toEqual({ clientId: 'set', clientSecret: 'set' });
    expect(dto.hasCredentials).toBe(true);
    expect(dto.counts).toEqual({ products: 3, orders: 7 });

    // No raw secret leaks anywhere in the serialized JSON.
    const json = JSON.stringify(dto);
    expect(json.includes('super-secret-XYZ')).toBe(false);
    expect(json.includes('bol-client-123')).toBe(false);
  });

  it('toChannelDto returns empty mask for a channel with no credentials', () => {
    const dto = serialize.toChannelDto(makeChannel({ credentials: null }));
    expect(dto.credentials).toEqual({});
    expect(dto.hasCredentials).toBe(false);
  });
});

describe('channels adapters — registry + guard behavior', () => {
  it('getAdapter resolves all four supported types', () => {
    expect(registry.getAdapter('own_webshop')?.type).toBe('own_webshop');
    expect(registry.getAdapter('bol')?.type).toBe('bol');
    expect(registry.getAdapter('amazon')?.type).toBe('amazon');
    expect(registry.getAdapter('gmc')?.type).toBe('gmc');
    expect(registry.getAdapter('ebay')).toBeNull();
    expect(registry.SUPPORTED_CHANNEL_TYPES).toEqual(
      expect.arrayContaining(['own_webshop', 'bol', 'amazon', 'gmc']),
    );
  });

  it('getAdapter resolves from a Channel row by its type', () => {
    const ch = makeChannel({ type: 'amazon' });
    expect(registry.getAdapter(ch)?.type).toBe('amazon');
  });

  it('bol verifyConnection returns credentials-required when not connected (no live fire)', async () => {
    const ch = makeChannel({ type: 'bol', status: 'disconnected', credentials: null });
    const r = await bolMod.bolAdapter.verifyConnection(ch);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('Bol credentials required');
  });

  it('bol fetchOrders throws a typed channel_not_connected when not connected', async () => {
    const ch = makeChannel({ type: 'bol', status: 'disconnected', credentials: null });
    await expect(bolMod.bolAdapter.fetchOrders(ch)).rejects.toSatisfy((e) =>
      types.isChannelNotConnectedError(e),
    );
  });

  it('amazon verifyConnection returns credentials-required when not connected', async () => {
    const ch = makeChannel({ type: 'amazon', status: 'disconnected', credentials: null });
    const r = await amazonMod.amazonAdapter.verifyConnection(ch);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('Amazon credentials required');
  });

  it('bol verifyConnection still reports not-connected when status=connected but creds empty', async () => {
    const ch = makeChannel({ type: 'bol', status: 'connected', credentials: null });
    const r = await bolMod.bolAdapter.verifyConnection(ch);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('Bol credentials required');
  });

  it('own_webshop adapter is the real adapter (instance type)', () => {
    expect(ownMod.ownWebshopAdapter.type).toBe('own_webshop');
    expect(ownMod.ownWebshopAdapter).toBeInstanceOf(ownMod.OwnWebshopAdapter);
  });
});

describe('channels credentials roundtrip (encrypt → store-shape → decrypt → mask)', () => {
  it('round-trips bol credentials through the stored jsonb shape', () => {
    const creds = { clientId: 'cid-abc', clientSecret: 'csecret-xyz' };
    const stored = crypto.encryptCredentials(creds); // { enc }
    expect(typeof stored.enc).toBe('string');

    const back = crypto.decryptCredentials(stored);
    expect(back).toEqual(creds);

    // What the API may expose: presence-map only.
    expect(crypto.maskCredentials(back)).toEqual({ clientId: 'set', clientSecret: 'set' });
  });
});
