/**
 * Shop-scoping voor de publieke storefront-API.
 *
 * Elke storefront-request MOET een shop identificeren. Resolutie-volgorde:
 *   0. PUBLISHABLE TOKEN — header `X-Storefront-Token` of query
 *      `?storefront_token=`  (de OFFICIËLE headless-connect-weg, à la Shopify
 *      `X-Shopify-Storefront-Access-Token` / Medusa `x-publishable-api-key`).
 *      We matchen `sha256(token)` tegen `shops.storefront_token_hash`.
 *   1. Header `X-Shop-Slug: <slug>`        (back-compat fallback)
 *   2. Query  `?shop=<slug>`               (back-compat fallback)
 *   3. Header `X-Shop-Domain: <domain>`    (handig wanneer de storefront op een
 *      custom domein draait en een reverse-proxy de Host doorgeeft)
 *
 * De token is het officiële pad; slug/domain blijven werken zodat bestaande
 * flows niet breken. Heeft een shop een token gezet, dan mag slug NOG STEEDS —
 * we hard-breaken niets (back-compat is leidend).
 *
 * We resolven naar de `shops`-row en cachen die op de Hono-context via
 * `c.set('shop', shop)`. Onbekende/niet-actieve shop → 404.
 *
 * NB: dit is GEEN `requireAuth`. De storefront-API is publiek. Het token is
 * "publishable" (niet-geheim) maar identificeert wél deterministisch één shop.
 * Schrijf-flows (cart/checkout) zijn per definitie publiek maar wel shop-scoped
 * + voorraad-gevalideerd.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { shops, type Shop } from '../../db/schema/index.js';

export type StorefrontVariables = {
  shop: Shop;
};

/** Prefix van publishable storefront-tokens (zie shops/storefront-token.ts). */
const STOREFRONT_TOKEN_PREFIX = 'wcrm_pk_';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: string | undefined | null): v is string {
  return typeof v === 'string' && UUID_REGEX.test(v);
}

/** Lees de shop-identifier uit header/query. */
export function readShopIdentifier(c: Context): {
  token?: string;
  slug?: string;
  domain?: string;
} {
  const headerToken = c.req.header('x-storefront-token')?.trim();
  const queryToken = c.req.query('storefront_token')?.trim();
  const headerSlug = c.req.header('x-shop-slug')?.trim();
  const querySlug = c.req.query('shop')?.trim();
  const headerDomain = c.req.header('x-shop-domain')?.trim();
  return {
    token: headerToken || queryToken || undefined,
    slug: headerSlug || querySlug || undefined,
    domain: headerDomain || undefined,
  };
}

/** sha256-hash (hex) van een storefront-token — moet matchen met de generator. */
export function hashStorefrontToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Lichte vorm-filter: juiste prefix + minimale lengte. Voorkomt een DB-lookup
 * voor willekeurige strings. Dit is GEEN auth — de echte check is de hash-match.
 */
function looksLikeStorefrontToken(token: string): boolean {
  return (
    token.startsWith(STOREFRONT_TOKEN_PREFIX) &&
    token.length >= STOREFRONT_TOKEN_PREFIX.length + 20
  );
}

/**
 * Resolve een shop op publishable token (de officiële weg). Matcht
 * `sha256(token)` tegen `shops.storefront_token_hash`. Alleen `status='active'`.
 * Geeft `null` bij ongeldig formaat of geen match.
 */
export async function resolveShopByToken(token?: string): Promise<Shop | null> {
  if (!token || !looksLikeStorefrontToken(token)) return null;
  const hash = hashStorefrontToken(token);
  const [row] = await db
    .select()
    .from(shops)
    .where(eq(shops.storefrontTokenHash, hash))
    .limit(1);
  if (!row) return null;
  if (row.status !== 'active') return null;
  return row;
}

/** Resolve een shop op slug of domain. Alleen `status='active'`. */
export async function resolveShop(
  slug?: string,
  domain?: string,
): Promise<Shop | null> {
  if (!slug && !domain) return null;

  const conditions = [];
  if (slug) conditions.push(eq(shops.slug, slug));
  if (domain) conditions.push(eq(shops.domain, domain));
  const whereExpr = conditions.length === 1 ? conditions[0] : or(...conditions);

  const [row] = await db.select().from(shops).where(whereExpr!).limit(1);
  if (!row) return null;
  if (row.status !== 'active') return null;
  return row;
}

/**
 * Middleware: resolve shop en zet op context. 400 als geen identifier,
 * 404 als onbekend/niet-actief.
 */
export const shopScope: MiddlewareHandler<{
  Variables: StorefrontVariables;
}> = async (c, next) => {
  const { token, slug, domain } = readShopIdentifier(c);
  if (!token && !slug && !domain) {
    return c.json(
      {
        error: 'shop_required',
        message:
          'Geef een shop op via header X-Storefront-Token (officiële weg) of ' +
          '?shop=<slug> / X-Shop-Slug / X-Shop-Domain (back-compat).',
      },
      400,
    );
  }

  // Officiële weg eerst: publishable token. Daarna slug/domain als fallback
  // (back-compat) zodat bestaande storefront-flows blijven werken.
  let shop = token ? await resolveShopByToken(token) : null;
  if (!shop && (slug || domain)) {
    shop = await resolveShop(slug, domain);
  }

  if (!shop) {
    return c.json({ error: 'shop_not_found' }, 404);
  }
  c.set('shop', shop);
  await next();
};
