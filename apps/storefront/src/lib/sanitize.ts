/**
 * XSS-sanitatie voor HTML die we via dangerouslySetInnerHTML renderen.
 *
 * CMS-/product-/blog-content wordt door shop-eigenaren beheerd, maar dat is
 * geen garantie tegen XSS (een gecompromitteerd admin-account, een ge-import-te
 * feed, …). We saneren daarom altijd aan de renderkant met DOMPurify.
 *
 * Eén helper → één plek om de policy aan te scherpen.
 */
import DOMPurify from 'dompurify';

/**
 * Saneer een HTML-string tot een veilige subset. Geeft '' terug voor lege/null
 * input. Externe links krijgen rel=noopener noreferrer via een hook (target
 * mag blijven staan, maar mag geen tab-nabbing toelaten).
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
  });
}
