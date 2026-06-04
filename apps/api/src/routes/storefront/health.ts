/**
 * Storefront connectivity-check.
 *
 *   GET /api/storefront/v1/health
 *
 * Goedkope ping die een connect-panel of SDK kan gebruiken om te verifiëren
 * dat de storefront-API bereikbaar is en (optioneel) of een meegegeven shop
 * resolvet. Werkt MET en ZONDER shop-identifier:
 *   - met `?shop=<slug>` of header `X-Shop-Slug` / `X-Shop-Domain`:
 *       → resolvet de shop; bij hit `shop=<slug>`, bij onbekende/inactieve
 *         shop blijft `shop=null` (de check zelf blijft `ok:true`).
 *   - zonder identifier: `shop=null`.
 *
 * Daarom hangt deze route NIET achter `shopScope` (die zou 400 geven zonder
 * shop). We doen de resolutie hier zelf, optioneel.
 */
import type { Context } from 'hono';
import { readShopIdentifier, resolveShop } from './_shop.js';

export async function storefrontHealth(c: Context): Promise<Response> {
  const { slug, domain } = readShopIdentifier(c);

  let resolvedSlug: string | null = null;
  if (slug || domain) {
    const shop = await resolveShop(slug, domain).catch(() => null);
    resolvedSlug = shop?.slug ?? null;
  }

  return c.json({
    ok: true,
    shop: resolvedSlug,
    ts: new Date().toISOString(),
  });
}
