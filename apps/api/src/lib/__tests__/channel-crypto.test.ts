/**
 * Unit-tests voor channel-crypto (AES-256-GCM credential-encryptie).
 *
 * env.CHANNEL_SECRET_KEY moet >=32 chars zijn — we zetten 'm in de test-env
 * vóór de module-import zodat `env` valideert. (vitest laadt .env normaliter
 * via de api; deze fallback maakt de test self-contained.)
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

const { encryptCredentials, decryptCredentials, maskCredentials } = await import(
  '../channel-crypto.js'
);

describe('channel-crypto', () => {
  it('decrypt(encrypt(x)) deep-equals x', () => {
    const creds = {
      clientId: 'bol-client-123',
      clientSecret: 'super-secret-token-XYZ',
      scopes: ['read', 'write'],
      meta: { nested: true, count: 7 },
    };
    const { enc } = encryptCredentials(creds);
    const back = decryptCredentials({ enc });
    expect(back).toEqual(creds);
  });

  it('stored .enc differs from the JSON of x (ciphertext, not plaintext)', () => {
    const creds = { apiKey: 'amazon-key-abc' };
    const { enc } = encryptCredentials(creds);
    expect(enc).not.toEqual(JSON.stringify(creds));
    // Het ruwe geheim mag NIET letterlijk in de blob staan.
    expect(enc.includes('amazon-key-abc')).toBe(false);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const creds = { token: 'same-input' };
    const a = encryptCredentials(creds).enc;
    const b = encryptCredentials(creds).enc;
    expect(a).not.toEqual(b);
    // Maar beide ontsleutelen naar dezelfde plaintext.
    expect(decryptCredentials({ enc: a })).toEqual(creds);
    expect(decryptCredentials({ enc: b })).toEqual(creds);
  });

  it('decryptCredentials returns null for null/undefined/empty/corrupt input', () => {
    expect(decryptCredentials(null)).toBeNull();
    expect(decryptCredentials(undefined)).toBeNull();
    expect(decryptCredentials({ enc: '' })).toBeNull();
    expect(decryptCredentials({ enc: 'not-three-parts' })).toBeNull();
    expect(decryptCredentials({ enc: 'aaa:bbb:ccc' })).toBeNull(); // bad lengths
  });

  it('decryptCredentials returns null when the blob is tampered with', () => {
    const { enc } = encryptCredentials({ secret: 'x' });
    const parts = enc.split(':');
    // Flip a byte in the ciphertext segment → authTag-mismatch → null.
    const tampered = `${parts[0]}:${parts[1]}:${Buffer.from('garbage').toString('base64')}`;
    expect(decryptCredentials({ enc: tampered })).toBeNull();
  });

  it('maskCredentials reports presence flags only, never raw values', () => {
    const masked = maskCredentials({
      clientId: 'present',
      clientSecret: 'also-present',
      empty: '',
      missing: null,
    });
    expect(masked).toEqual({
      clientId: 'set',
      clientSecret: 'set',
      empty: null,
      missing: null,
    });
    // No raw value leaks through.
    expect(Object.values(masked).every((v) => v === 'set' || v === null)).toBe(true);
  });

  it('maskCredentials handles null object', () => {
    expect(maskCredentials(null)).toEqual({});
  });
});
