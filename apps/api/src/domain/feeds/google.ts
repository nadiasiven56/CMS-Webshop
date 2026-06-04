/**
 * Google Shopping feed-renderer — RSS 2.0 met de Google-product-namespace
 * (`xmlns:g="http://base.google.com/ns/1.0"`).
 *
 * Output is een geldige RSS 2.0 `<rss><channel>…<item>…</item></channel></rss>`
 * waar elk product een `<item>` is met `<g:id>`, `<g:title>`, `<g:price>`,
 * `<g:availability>`, `<g:image_link>`, etc. Operator plakt de publieke feed-URL
 * in Google Merchant Center; GMC crawlt de URL periodiek.
 *
 * NEVER-THROW + lege feed: 0 items → geldige `<channel>` zonder `<item>`s.
 * Alle tekst wordt XML-ge-escaped via {@link escapeXml}.
 *
 * Spec-referenties (feed-attributen):
 *   https://support.google.com/merchants/answer/7052112
 */
import type { FeedItem, FeedShop } from './types.js';

/**
 * Escape de 5 XML-predefined entities. Voldoende voor element-tekst én
 * attribuut-waarden (we escapen ook quotes). Geen CDATA — escaping is
 * deterministisch en valideert overal.
 */
export function escapeXml(value: string | null | undefined): string {
  if (value == null) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Google-prijs-notatie: "<amount> <CURRENCY>", bv. "19.99 EUR". */
function googlePrice(price: string, currency: string): string {
  // Money is een 4-decimalen-string; toon 2 decimalen voor de feed.
  const n = Number(price);
  const amount = Number.isFinite(n) ? n.toFixed(2) : price;
  return `${amount} ${currency}`;
}

/** Render één `<item>`. Alleen niet-lege optionele velden worden geëmit. */
function renderItem(item: FeedItem): string {
  const lines: string[] = ['    <item>'];

  lines.push(`      <g:id>${escapeXml(item.id)}</g:id>`);
  lines.push(`      <title>${escapeXml(item.title)}</title>`);
  lines.push(`      <description>${escapeXml(item.description)}</description>`);
  lines.push(`      <link>${escapeXml(item.link)}</link>`);
  if (item.imageLink) {
    lines.push(`      <g:image_link>${escapeXml(item.imageLink)}</g:image_link>`);
  }
  lines.push(
    `      <g:availability>${escapeXml(item.availability)}</g:availability>`,
  );
  lines.push(
    `      <g:price>${escapeXml(googlePrice(item.price, item.currency))}</g:price>`,
  );
  lines.push(`      <g:condition>${escapeXml(item.condition)}</g:condition>`);
  if (item.brand) {
    lines.push(`      <g:brand>${escapeXml(item.brand)}</g:brand>`);
  }
  if (item.gtin) {
    lines.push(`      <g:gtin>${escapeXml(item.gtin)}</g:gtin>`);
  }
  // identifier_exists=no als er geen GTIN én geen merk is (Google-aanrader).
  if (!item.gtin && !item.brand) {
    lines.push('      <g:identifier_exists>no</g:identifier_exists>');
  }
  if (item.sku) {
    lines.push(`      <g:mpn>${escapeXml(item.sku)}</g:mpn>`);
  }
  if (item.productType) {
    lines.push(
      `      <g:product_type>${escapeXml(item.productType)}</g:product_type>`,
    );
  }

  lines.push('    </item>');
  return lines.join('\n');
}

/**
 * Render de volledige Google Shopping RSS 2.0-feed. Geeft ALTIJD een geldige
 * XML-string terug — ook bij 0 items.
 */
export function renderGoogleShoppingXml(shop: FeedShop, items: FeedItem[]): string {
  const itemsXml = items.map(renderItem).join('\n');
  const title = escapeXml(`${shop.name} — productfeed`);
  const link = shop.domain
    ? `https://${escapeXml(shop.domain)}`
    : escapeXml(`shop:${shop.slug}`);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '  <channel>',
    `    <title>${title}</title>`,
    `    <link>${link}</link>`,
    `    <description>${escapeXml(`Google Shopping feed voor ${shop.name}`)}</description>`,
    itemsXml,
    '  </channel>',
    '</rss>',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n')
    // De lege itemsXml zou anders een dubbele newline geven; normaliseer niet
    // verder — dit blijft valide XML.
    .concat('\n');
}
