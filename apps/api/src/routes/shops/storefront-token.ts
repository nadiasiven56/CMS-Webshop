/**
 * Per-shop PUBLISHABLE storefront-token — admin-beheer.
 *
 * Concept (à la Shopify `X-Shopify-Storefront-Access-Token` / Medusa
 * `x-publishable-api-key`): een NIET-geheim, scoped token dat de externe webshop
 * bij ELKE storefront-call meestuurt om de shop te authenticeren (i.p.v. alleen
 * een slug). Het is "publishable" — bedoeld om in client-side code te staan —
 * maar identificeert wél deterministisch één shop en kan geroteerd worden.
 *
 * Beveiliging: we slaan ALLEEN de sha256-hash op (`shops.storefront_token_hash`),
 * nooit de raw waarde. De raw waarde wordt PRECIES ÉÉN KEER teruggegeven, bij
 * generatie/rotatie. Daarna is hij niet meer op te halen — alleen of er één
 * gezet is (`hasToken: boolean`).
 *
 * Token-format: `wcrm_pk_<base64url van 32 random bytes>`.
 *   - `wcrm_pk_` prefix = herkenbaar (webshop-crm publishable key), zoals
 *     Stripe `pk_`, Medusa `pk_`.
 *   - 32 random bytes (256 bits entropie) via node:crypto.randomBytes.
 *   - base64url (geen '+', '/', '=') zodat het token URL-/header-safe is.
 *
 * Routes (registreren op de bestaande `shopsRoutes`, dus achter `requireAuth`):
 *   GET    /api/shops/:id/storefront-token  → { hasToken: boolean }  (nooit raw)
 *   POST   /api/shops/:id/storefront-token  → genereer/roteer; { token, hasToken,
 *                                              rotated }  (raw token ÉÉN keer)
 *   DELETE /api/shops/:id/storefront-token  → trek token in; { ok, hasToken:false }
 *
 * Writes lopen via `runInTransactionWithAudit` zodat `audit_log` automatisch
 * meeschrijft. De raw token komt NOOIT in audit/log terecht.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import type { AuthVariables } from '../../middleware/auth.js';
import { shops } from '../../db/schema/shops.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { canAccessShop } from '../../lib/access.js';
import { isUuid } from '../../domain/shops/shop-context.js';

/** Prefix voor publishable storefront-tokens (webshop-crm publishable key). */
export const STOREFRONT_TOKEN_PREFIX = 'wcrm_pk_';

/** Aantal random bytes ná de prefix (256 bits). */
const TOKEN_RANDOM_BYTES = 32;

/**
 * Genereer een nieuw publishable storefront-token.
 * Format: `wcrm_pk_<base64url(32 random bytes)>`.
 */
export function generateStorefrontToken(): string {
  const random = randomBytes(TOKEN_RANDOM_BYTES).toString('base64url');
  return `${STOREFRONT_TOKEN_PREFIX}${random}`;
}

/**
 * Hash een storefront-token (sha256, hex) voor opslag/vergelijking.
 * Deterministisch: hetzelfde token → dezelfde hash. We trimmen NIET en
 * normaliseren NIET — het token moet byte-voor-byte kloppen.
 */
export function hashStorefrontToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Lichte vorm-validatie: heeft de juiste prefix en genoeg lengte. Dit is GEEN
 * authenticatie — alleen een goedkope filter zodat de resolver niet voor elke
 * willekeurige string een DB-lookup doet.
 */
export function looksLikeStorefrontToken(token: string | undefined | null): token is string {
  return (
    typeof token === 'string' &&
    token.startsWith(STOREFRONT_TOKEN_PREFIX) &&
    token.length >= STOREFRONT_TOKEN_PREFIX.length + 20
  );
}

/**
 * Registreer de storefront-token-routes op een bestaande shops-router.
 * Wordt aangeroepen vanuit `shops/index.ts` (binnen shops-ownership) zodat er
 * GEEN extra mount in `routes/index.ts` nodig is — `shopsRoutes` is daar al
 * gemount op `/api/shops`.
 */
export function registerStorefrontTokenRoutes(
  router: Hono<{ Variables: AuthVariables }>,
): void {
  // ─── GET /api/shops/:id/storefront-token — presence-check ──────
  router.get('/:id/storefront-token', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) {
      return c.json({ error: 'invalid_id' }, 400);
    }
    // Multi-user: non-member krijgt 404 (geen existence-leak).
    if (!(await canAccessShop(c.get('user'), id))) {
      return c.json({ error: 'not_found' }, 404);
    }
    const [shop] = await db
      .select({ id: shops.id, hash: shops.storefrontTokenHash })
      .from(shops)
      .where(eq(shops.id, id))
      .limit(1);
    if (!shop) {
      return c.json({ error: 'not_found' }, 404);
    }
    // NOOIT de hash of raw token teruggeven — alleen of er één gezet is.
    return c.json({ hasToken: shop.hash !== null && shop.hash !== '' });
  });

  // ─── POST /api/shops/:id/storefront-token — genereer / roteer ──
  router.post('/:id/storefront-token', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) {
      return c.json({ error: 'invalid_id' }, 400);
    }
    const user = c.get('user');
    // Multi-user: non-member krijgt 404 (geen existence-leak).
    if (!(await canAccessShop(user, id))) {
      return c.json({ error: 'not_found' }, 404);
    }
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

    const [existing] = await db
      .select({ id: shops.id, hash: shops.storefrontTokenHash })
      .from(shops)
      .where(eq(shops.id, id))
      .limit(1);
    if (!existing) {
      return c.json({ error: 'not_found' }, 404);
    }
    const rotated = existing.hash !== null && existing.hash !== '';

    const token = generateStorefrontToken();
    const tokenHash = hashStorefrontToken(token);

    await runInTransactionWithAudit(async (tx, audit) => {
      const [row] = await tx
        .update(shops)
        .set({ storefrontTokenHash: tokenHash, updatedAt: new Date() })
        .where(eq(shops.id, id))
        .returning({ id: shops.id });
      if (!row) throw new Error('storefront-token update returned no row');

      // De RAW token komt NOOIT in de audit-log — alleen het feit dat er
      // (her)gegenereerd is.
      audit.set({
        actor: { type: 'user', id: user.id },
        action: rotated ? 'rotate' : 'create',
        entityType: 'shop_storefront_token',
        entityId: id,
        before: rotated ? { hasToken: true } : null,
        after: { hasToken: true },
        ip,
      });
    });

    logger.info(
      { shopId: id, actor: user.id, rotated },
      'storefront token (re)generated',
    );

    // Raw token ÉÉN keer terug — daarna niet meer ophaalbaar.
    return c.json({ token, hasToken: true, rotated }, rotated ? 200 : 201);
  });

  // ─── DELETE /api/shops/:id/storefront-token — intrekken ────────
  router.delete('/:id/storefront-token', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) {
      return c.json({ error: 'invalid_id' }, 400);
    }
    const user = c.get('user');
    // Multi-user: non-member krijgt 404 (geen existence-leak).
    if (!(await canAccessShop(user, id))) {
      return c.json({ error: 'not_found' }, 404);
    }
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

    const [existing] = await db
      .select({ id: shops.id, hash: shops.storefrontTokenHash })
      .from(shops)
      .where(eq(shops.id, id))
      .limit(1);
    if (!existing) {
      return c.json({ error: 'not_found' }, 404);
    }
    const had = existing.hash !== null && existing.hash !== '';

    if (had) {
      await runInTransactionWithAudit(async (tx, audit) => {
        await tx
          .update(shops)
          .set({ storefrontTokenHash: null, updatedAt: new Date() })
          .where(eq(shops.id, id));
        audit.set({
          actor: { type: 'user', id: user.id },
          action: 'revoke',
          entityType: 'shop_storefront_token',
          entityId: id,
          before: { hasToken: true },
          after: { hasToken: false },
          ip,
        });
      });
      logger.info({ shopId: id, actor: user.id }, 'storefront token revoked');
    }

    return c.json({ ok: true, hasToken: false });
  });
}
