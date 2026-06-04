/**
 * Unit + REAL-DB tests voor het PUBLISHABLE storefront-token (Wave-H A3).
 *
 * Deel 1 (puur, geen DB): token-format + hash-determinisme + vorm-filter.
 * Deel 2 (echte Postgres :7432): generate → hash → resolve roundtrip via de
 *   storefront-resolver (`resolveShopByToken`), ÉN bevestig dat de slug-fallback
 *   (`resolveShop`) blijft werken (back-compat).
 *
 * env-fallback vóór module-import zodat `env` valideert (zelfde patroon als
 * channel-crypto.test.ts). De DB-rijen worden in afterAll opgeruimd.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  if (!process.env.CHANNEL_SECRET_KEY || process.env.CHANNEL_SECRET_KEY.length < 32) {
    process.env.CHANNEL_SECRET_KEY = 'test-channel-secret-key-0123456789abcdef';
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    process.env.SESSION_SECRET = 'test-session-secret-key-0123456789abcdef';
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgres://localhost:7432/webshop_crm';
  }
});

const {
  generateStorefrontToken,
  hashStorefrontToken,
  looksLikeStorefrontToken,
  STOREFRONT_TOKEN_PREFIX,
} = await import('../storefront-token.js');

const { db, closeDb } = await import('../../../lib/db.js');
const { shops } = await import('../../../db/schema/shops.js');
const { eq } = await import('drizzle-orm');
const { resolveShopByToken, resolveShop, hashStorefrontToken: resolverHash } = await import(
  '../../storefront/_shop.js'
);

// ─────────────────────────────────────────────────────────────
// Deel 1 — puur (geen DB)
// ─────────────────────────────────────────────────────────────
describe('storefront-token — format + hash (puur)', () => {
  it('genereert een token met de wcrm_pk_-prefix en genoeg entropie', () => {
    const t = generateStorefrontToken();
    expect(t.startsWith(STOREFRONT_TOKEN_PREFIX)).toBe(true);
    expect(t).toBe(`${STOREFRONT_TOKEN_PREFIX}${t.slice(STOREFRONT_TOKEN_PREFIX.length)}`);
    // 32 random bytes → base64url ~43 chars; samen met prefix ruim boven de filter.
    expect(t.length).toBeGreaterThanOrEqual(STOREFRONT_TOKEN_PREFIX.length + 40);
    // base64url: alleen A-Za-z0-9-_ ná de prefix (geen +, /, =).
    const body = t.slice(STOREFRONT_TOKEN_PREFIX.length);
    expect(/^[A-Za-z0-9_-]+$/.test(body)).toBe(true);
  });

  it('genereert elke keer een uniek token', () => {
    const a = generateStorefrontToken();
    const b = generateStorefrontToken();
    expect(a).not.toEqual(b);
  });

  it('hash is deterministisch en hex (sha256 = 64 hex chars)', () => {
    const t = generateStorefrontToken();
    const h1 = hashStorefrontToken(t);
    const h2 = hashStorefrontToken(t);
    expect(h1).toEqual(h2);
    expect(/^[0-9a-f]{64}$/.test(h1)).toBe(true);
    // De raw token zit NIET in de hash.
    expect(h1.includes(t)).toBe(false);
  });

  it('resolver-hash == endpoint-hash (zelfde algoritme, anders breekt matching)', () => {
    const t = generateStorefrontToken();
    expect(resolverHash(t)).toEqual(hashStorefrontToken(t));
  });

  it('looksLikeStorefrontToken filtert rommel weg', () => {
    expect(looksLikeStorefrontToken(generateStorefrontToken())).toBe(true);
    expect(looksLikeStorefrontToken('wcrm_pk_short')).toBe(false);
    expect(looksLikeStorefrontToken('not-a-token')).toBe(false);
    expect(looksLikeStorefrontToken('')).toBe(false);
    expect(looksLikeStorefrontToken(undefined)).toBe(false);
    expect(looksLikeStorefrontToken(null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Deel 2 — REAL-DB roundtrip + slug-fallback
// ─────────────────────────────────────────────────────────────
const RUN = Date.now().toString(36);
const SLUG = `sf-tok-${RUN}`;
let shopId = '';

beforeAll(async () => {
  const [shop] = await db
    .insert(shops)
    .values({ slug: SLUG, name: 'Token Test Shop', status: 'active' })
    .returning();
  shopId = shop!.id;
});

afterAll(async () => {
  try {
    if (shopId) {
      await db.delete(shops).where(eq(shops.id, shopId));
    }
  } finally {
    await closeDb();
  }
});

describe('storefront-token — resolve roundtrip (echte DB)', () => {
  it('generate → store hash → resolveShopByToken vindt de shop', async () => {
    const token = generateStorefrontToken();
    const hash = hashStorefrontToken(token);

    await db.update(shops).set({ storefrontTokenHash: hash }).where(eq(shops.id, shopId));

    const resolved = await resolveShopByToken(token);
    expect(resolved).toBeTruthy();
    expect(resolved!.id).toBe(shopId);
    expect(resolved!.slug).toBe(SLUG);
  });

  it('een verkeerd/niet-bestaand token resolvet naar null', async () => {
    const other = generateStorefrontToken(); // nooit opgeslagen
    expect(await resolveShopByToken(other)).toBeNull();
    // Foutief formaat → ook null (geen DB-lookup).
    expect(await resolveShopByToken('garbage')).toBeNull();
    expect(await resolveShopByToken(undefined)).toBeNull();
  });

  it('slug-fallback blijft werken (back-compat) — token breekt slug niet', async () => {
    // De shop HEEFT nu een token gezet (vorige test), maar slug moet nog steeds
    // resolven — we hard-breaken bestaande flows niet.
    const bySlug = await resolveShop(SLUG, undefined);
    expect(bySlug).toBeTruthy();
    expect(bySlug!.id).toBe(shopId);
  });

  it('niet-actieve shop resolvet niet via token', async () => {
    const token = generateStorefrontToken();
    const hash = hashStorefrontToken(token);
    await db
      .update(shops)
      .set({ storefrontTokenHash: hash, status: 'paused' })
      .where(eq(shops.id, shopId));

    expect(await resolveShopByToken(token)).toBeNull();

    // herstel voor nette teardown-assumpties
    await db.update(shops).set({ status: 'active' }).where(eq(shops.id, shopId));
  });
});
