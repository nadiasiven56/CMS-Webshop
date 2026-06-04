/**
 * Actieve shop-slug: uit de URL-query `?shop=<slug>`, default `crema`.
 * Eén app, beide demo-shops via `?shop=crema` / `?shop=pawfect`.
 *
 * De slug wordt als header `X-Shop-Slug` op elke API-call meegestuurd
 * (zie api/client.ts). We lezen 'm uit `window.location` zodat hij ook
 * vóór de router-mount al beschikbaar is.
 */

export const DEFAULT_SHOP_SLUG = 'crema';

/** Lees de actieve shop-slug uit de huidige URL-query. */
export function getActiveShopSlug(): string {
  if (typeof window === 'undefined') return DEFAULT_SHOP_SLUG;
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('shop')?.trim();
  return slug && slug.length > 0 ? slug : DEFAULT_SHOP_SLUG;
}

/**
 * Behoud de `?shop=` query bij interne navigatie zodat je niet per ongeluk
 * van shop wisselt. Geeft een href met de shop-query eraan vastgeplakt.
 */
export function withShopQuery(path: string): string {
  const slug = getActiveShopSlug();
  if (slug === DEFAULT_SHOP_SLUG) {
    // Default hoeft niet expliciet in de URL, maar als hij er al staat
    // (gebruiker kwam binnen met ?shop=crema) houden we 'm consistent.
    const current = new URLSearchParams(window.location.search).get('shop');
    if (!current) return path;
  }
  const hashIdx = path.indexOf('#');
  const base = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
  const hash = hashIdx >= 0 ? path.slice(hashIdx + 1) : '';
  const sep = base.includes('?') ? '&' : '?';
  const withQuery = `${base}${sep}shop=${encodeURIComponent(slug)}`;
  return hash ? `${withQuery}#${hash}` : withQuery;
}

/** localStorage-key voor de cart-token, per shop gescheiden. */
export function cartTokenKey(slug: string = getActiveShopSlug()): string {
  return `storefront.cart-token.${slug}`;
}
