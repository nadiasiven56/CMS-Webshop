/**
 * Meta (Facebook/Instagram) catalog feed-renderer — CSV.
 *
 * Output is een RFC-4180-conforme CSV met de Meta-catalog-kolommen. Operator
 * plakt de publieke feed-URL in Meta Commerce Manager → "Data sources" →
 * "Scheduled feed"; Meta haalt de CSV periodiek op.
 *
 * Header (vaste volgorde, Meta-verplichte + aanbevolen velden):
 *   id, title, description, availability, condition, price, link, image_link, brand
 *
 * Meta-eigenaardigheden die we volgen:
 *   - `price` = "<amount> <CURRENCY>", bv. "19.99 EUR" (zelfde als Google).
 *   - `availability` = 'in stock' | 'out of stock' (SPATIE, niet underscore!).
 *   - `condition` = 'new' | 'refurbished' | 'used'.
 *
 * NEVER-THROW + lege feed: 0 items → alleen de header-regel (geldige CSV).
 * Escaping via {@link csvField}: velden met komma/quote/newline worden
 * ge-quote en interne quotes verdubbeld.
 */
import type { FeedItem, FeedShop } from './types.js';

/** Vaste kolom-volgorde van de Meta-catalog-CSV. */
export const META_CSV_HEADER = [
  'id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'link',
  'image_link',
  'brand',
] as const;

/**
 * Quote/escape één CSV-veld per RFC-4180:
 *   - null/undefined → leeg veld
 *   - bevat `,` `"` `\n` of `\r` → omsluit met dubbele quotes
 *   - interne `"` → verdubbel naar `""`
 */
export function csvField(value: string | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Meta-availability-vocabulaire (SPATIE-vorm). */
function metaAvailability(a: FeedItem['availability']): string {
  return a === 'in_stock' ? 'in stock' : 'out of stock';
}

/** Meta-prijs-notatie: "<amount> <CURRENCY>". */
function metaPrice(price: string, currency: string): string {
  const n = Number(price);
  const amount = Number.isFinite(n) ? n.toFixed(2) : price;
  return `${amount} ${currency}`;
}

/** Render één data-rij in de header-volgorde. */
function renderRow(item: FeedItem): string {
  const fields = [
    item.id,
    item.title,
    item.description,
    metaAvailability(item.availability),
    item.condition,
    metaPrice(item.price, item.currency),
    item.link,
    item.imageLink,
    item.brand,
  ];
  return fields.map(csvField).join(',');
}

/**
 * Render de volledige Meta-catalog-CSV. Geeft ALTIJD een geldige CSV terug —
 * ook bij 0 items (dan alleen de header-regel). CRLF line-endings (CSV-norm).
 */
export function renderMetaCsv(_shop: FeedShop, items: FeedItem[]): string {
  void _shop; // shop-context niet nodig in de CSV-body; signatuur-symmetrie met google.ts
  const lines: string[] = [META_CSV_HEADER.join(',')];
  for (const item of items) {
    lines.push(renderRow(item));
  }
  return lines.join('\r\n') + '\r\n';
}
