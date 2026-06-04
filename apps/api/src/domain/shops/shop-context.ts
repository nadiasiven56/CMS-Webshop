/**
 * shopContext — herbruikbare shop-resolver voor alle modules.
 *
 * Resolveert "welke shop is dit verzoek" naar een volledige `shops`-row, op
 * basis van (in volgorde van prioriteit):
 *   1. expliciete `opts.shop` (slug of uuid) — handig voor :id-routes
 *   2. query-param `?shop=<slug|id>`
 *   3. header `X-Shop-Id: <slug|id>`
 *
 * De waarde mag een UUID zijn (→ match op `shops.id`) of een willekeurige
 * string (→ match op `shops.slug`). Zo werkt zowel `?shop=crema` als
 * `?shop=<uuid>` en `X-Shop-Id: crema`.
 *
 * Gebruik (andere modules):
 * ```ts
 * import { resolveShopContext } from '../../domain/shops/shop-context.js';
 * const shop = await resolveShopContext(c);            // uit query/header
 * if (!shop) return c.json({ error: 'shop_not_found' }, 404);
 * // ... filter eigen query op shop.id
 * ```
 *
 * Of via de middleware-variant die `c.set('shop', shop)` zet en zelf 400/404
 * teruggeeft als er geen (geldige) shop is:
 * ```ts
 * router.use('*', shopContext());                       // required: true (default)
 * const shop = c.get('shop');                            // altijd gezet na middleware
 * ```
 */
import type { Context, MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { shops, type Shop } from '../../db/schema/shops.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: string | undefined | null): v is string {
  return typeof v === 'string' && UUID_REGEX.test(v);
}

/**
 * Resolveer een shop-identifier (uuid → id, anders → slug) naar een shop-row.
 * Pure DB-lookup, framework-agnostisch. `null` als niet gevonden.
 */
export async function findShopByIdentifier(
  identifier: string,
): Promise<Shop | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  const where = isUuid(trimmed)
    ? eq(shops.id, trimmed)
    : eq(shops.slug, trimmed);
  const [row] = await db.select().from(shops).where(where).limit(1);
  return row ?? null;
}

export interface ResolveShopOptions {
  /** Expliciete identifier (slug of uuid). Wint van query/header. */
  shop?: string | null;
}

/**
 * Lees de shop-identifier uit een Hono-context: expliciete optie →
 * `?shop=` → header `X-Shop-Id`. Geeft de raw string of `null`.
 */
export function readShopIdentifier(
  c: Context,
  opts: ResolveShopOptions = {},
): string | null {
  const explicit = opts.shop?.trim();
  if (explicit) return explicit;
  const query = c.req.query('shop')?.trim();
  if (query) return query;
  const header = c.req.header('x-shop-id')?.trim();
  if (header) return header;
  return null;
}

/**
 * Resolveer de shop voor dit verzoek naar een volledige `shops`-row of `null`.
 * Geeft NOOIT zelf een HTTP-response terug — de caller beslist 400/404.
 */
export async function resolveShopContext(
  c: Context,
  opts: ResolveShopOptions = {},
): Promise<Shop | null> {
  const identifier = readShopIdentifier(c, opts);
  if (!identifier) return null;
  return findShopByIdentifier(identifier);
}

/** Context-variable shape voor de middleware-variant. */
export type ShopContextVariables = {
  shop: Shop;
};

export interface ShopContextMiddlewareOptions {
  /**
   * Als `true` (default): geen identifier → 400 `shop_required`, onbekende
   * shop → 404 `shop_not_found`. Als `false`: zet niets en roept gewoon
   * `next()` aan (caller mag `c.get('shop')` undefined verwachten).
   */
  required?: boolean;
}

/**
 * Middleware die de shop resolved en op de context zet (`c.set('shop', ...)`).
 * Handig voor routers die volledig shop-scoped zijn (CMS, storefront, ...).
 */
export function shopContext(
  options: ShopContextMiddlewareOptions = {},
): MiddlewareHandler<{ Variables: ShopContextVariables }> {
  const required = options.required ?? true;
  return async (c, next) => {
    const identifier = readShopIdentifier(c);
    if (!identifier) {
      if (required) {
        return c.json(
          { error: 'shop_required', message: 'Geef ?shop=<slug|id> of header X-Shop-Id mee.' },
          400,
        );
      }
      await next();
      return;
    }
    const shop = await findShopByIdentifier(identifier);
    if (!shop) {
      if (required) {
        return c.json({ error: 'shop_not_found' }, 404);
      }
      await next();
      return;
    }
    c.set('shop', shop);
    await next();
  };
}
