/**
 * Kleine helpers voor request-validatie / shop-scoping voor de CMS-module.
 *
 * Alle CMS-resources zijn shop-scoped: lezen/schrijven gebeurt ALTIJD binnen
 * één shop. We resolven de shop uit `?shop=<slug|uuid>` (query) of het
 * `X-Shop-Id`-header (uuid). Voor write-paden mag de shop ook in de body zitten
 * via `shopId`.
 *
 * NB. `cms_media` is een uitzondering: `shop_id` mag NULL zijn (= globaal).
 */
import type { Context } from 'hono';
import { eq, or } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { shops } from '../../db/schema/index.js';
import { canAccessShop } from '../../lib/access.js';
import type { AuthUser } from '../../lib/auth.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Resolve een shop-referentie (uuid OF slug) naar een bestaande shop-id.
 * Returnt `null` als de ref ontbreekt of de shop niet bestaat.
 *
 * Multi-user: geef `user` mee om de membership-check toe te passen — een
 * non-admin die geen member van de shop is krijgt óók `null` terug, zodat
 * de caller een 404 geeft i.p.v. het bestaan van de shop te lekken.
 */
export async function resolveShopId(
  ref: string | undefined | null,
  user?: AuthUser,
): Promise<string | null> {
  if (!ref || typeof ref !== 'string' || ref.length === 0) return null;
  const trimmed = ref.trim();
  // uuid → match op id; anders → match op slug. We doen één query op beide
  // zodat een uuid die toevallig ook een slug is correct resolved.
  const [row] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(
      isUuid(trimmed)
        ? or(eq(shops.id, trimmed), eq(shops.slug, trimmed))
        : eq(shops.slug, trimmed),
    )
    .limit(1);
  const shopId = row?.id ?? null;
  if (!shopId) return null;
  if (user && !(await canAccessShop(user, shopId))) return null;
  return shopId;
}

/**
 * Lees de shop-referentie uit een request: `?shop=` query of `X-Shop-Id`
 * header. Returnt de ruwe ref-string (uuid of slug) of `undefined`.
 */
export function readShopRef(c: Context): string | undefined {
  const q = c.req.query('shop');
  if (q) return q;
  const header = c.req.header('x-shop-id');
  if (header) return header;
  return undefined;
}

/**
 * Convenience: resolve de shop voor read-routes. Bij ontbreken/onbekend
 * geeft de caller zelf de juiste 400/404 terug.
 *
 * Multi-user: leest de ingelogde user van de context (gezet door requireAuth)
 * en past de membership-check toe — een non-admin zonder membership op de
 * shop krijgt `{ shopId: null, provided: true }` → caller geeft 404
 * `shop_not_found` (geen existence-leak).
 */
export async function resolveShopFromRequest(
  c: Context,
): Promise<{ shopId: string | null; provided: boolean }> {
  const ref = readShopRef(c);
  if (!ref) return { shopId: null, provided: false };
  const user = c.get('user') as AuthUser | undefined;
  const shopId = await resolveShopId(ref, user);
  return { shopId, provided: true };
}
