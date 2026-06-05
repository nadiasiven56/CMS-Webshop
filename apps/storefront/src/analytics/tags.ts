/**
 * Storefront-marketing-tags loader.
 *
 * Laadt met ÉÉN scripttag de per-shop tags (GA4 / Google Ads / Meta Pixel /
 * Microsoft Clarity + custom-head-HTML) die de CMS server-side genereert op
 * basis van de in de admin ingevulde ids (Marketing → Analytics & tracking).
 *
 * - Relatief pad → werkt in dev (vite proxyt /api naar :7300) én in productie
 *   (single-origin via Caddy).
 * - Eenmalig per pageload (id-guard).
 * - Altijd veilig: zonder ingevulde ids of bij "Uit" levert de CMS een no-op
 *   script, dus dit hoeft niet conditioneel geladen te worden.
 */
const TAG_SCRIPT_ID = 'webshop-crm-storefront-tags';

export function injectStorefrontTags(shopId: string): void {
  if (!shopId || typeof document === 'undefined') return;
  if (document.getElementById(TAG_SCRIPT_ID)) return; // al geladen
  const s = document.createElement('script');
  s.id = TAG_SCRIPT_ID;
  s.async = true;
  s.src = `/api/feeds/public/${encodeURIComponent(shopId)}/tags.js`;
  (document.head || document.documentElement).appendChild(s);
}
