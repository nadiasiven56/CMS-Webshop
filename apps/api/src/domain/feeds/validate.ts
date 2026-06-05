/**
 * Google Merchant Center feed-validatie.
 *
 * Vóór de operator de publieke `google.xml`-feed in Merchant Center plakt, wil
 * hij weten of zijn producten de door GMC VERPLICHTE velden hebben — anders
 * worden items afgekeurd ("disapproved") zonder dat hij weet waarom. Deze module
 * draait dezelfde bron als de echte feed (`buildFeedItems`) en checkt per item.
 *
 * Onderscheid:
 *   - ERROR   = GMC keurt het item af (item komt niet in Shopping).
 *               Bron: https://support.google.com/merchants/answer/7052112
 *               Vereist: id, title, description, link, image_link, availability,
 *               price (> 0), condition.
 *   - WARNING = item wordt geaccepteerd maar met beperkt bereik / lagere
 *               kwaliteit. Belangrijkste: geen merk én geen GTIN (Google zet dan
 *               identifier_exists=no, wat bepaalde categorieën/Shopping-features
 *               blokkeert).
 *
 * NEVER-THROW: lege shop → leeg rapport (0 items). Pure read-side, geen mutatie.
 */
import { buildFeedItems } from './build.js';
import type { BuildFeedOpts, FeedItem } from './types.js';

/** Maximaal aantal probleem-items dat we als voorbeeld teruggeven. */
const SAMPLE_LIMIT = 50;

export interface FeedValidationIssue {
  /** Feed-id (SKU of variant-id) van het item. */
  itemId: string;
  title: string;
  /** Velden die GMC zou afkeuren. */
  errors: string[];
  /** Velden die het bereik/kwaliteit beperken (item wel geaccepteerd). */
  warnings: string[];
}

export interface FeedValidationReport {
  shopId: string;
  totalItems: number;
  /** Items zonder enige error én zonder warning. */
  okItems: number;
  itemsWithErrors: number;
  itemsWithWarnings: number;
  /** Tellers per probleem-veld (over alle items). */
  counts: {
    missingImageLink: number;
    invalidPrice: number;
    missingTitle: number;
    missingLink: number;
    missingDescription: number;
    /** Warning: geen merk én geen GTIN. */
    noBrandNoGtin: number;
    /** Info: geen GTIN (los geteld, niet per se blokkerend). */
    missingGtin: number;
  };
  /** Eerste {@link SAMPLE_LIMIT} probleem-items (errors eerst). */
  sample: FeedValidationIssue[];
}

/** Valideer één feed-item tegen de GMC-vereisten. */
export function validateFeedItem(item: FeedItem): FeedValidationIssue {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!item.title || item.title.trim().length === 0) errors.push('title');
  if (!item.description || item.description.trim().length === 0) errors.push('description');
  if (!item.link || item.link.trim().length === 0) errors.push('link');
  if (!item.imageLink || item.imageLink.trim().length === 0) errors.push('image_link');

  const priceNum = Number(item.price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) errors.push('price');

  const hasBrand = !!item.brand && item.brand.trim().length > 0;
  const hasGtin = !!item.gtin && item.gtin.trim().length > 0;
  if (!hasBrand && !hasGtin) warnings.push('brand_or_gtin');

  return { itemId: item.id, title: item.title, errors, warnings };
}

/**
 * Valideer de Google Shopping-feed van een shop. Respecteer dezelfde
 * includeOutOfStock/currency als de echte feed (geef ze mee vanuit feed_config).
 */
export async function validateGoogleFeed(
  shopId: string,
  opts: BuildFeedOpts = {},
): Promise<FeedValidationReport> {
  const items = await buildFeedItems(shopId, opts);

  const counts = {
    missingImageLink: 0,
    invalidPrice: 0,
    missingTitle: 0,
    missingLink: 0,
    missingDescription: 0,
    noBrandNoGtin: 0,
    missingGtin: 0,
  };

  let okItems = 0;
  let itemsWithErrors = 0;
  let itemsWithWarnings = 0;
  const sample: FeedValidationIssue[] = [];
  const warnSample: FeedValidationIssue[] = [];

  for (const item of items) {
    const issue = validateFeedItem(item);

    if (issue.errors.includes('image_link')) counts.missingImageLink++;
    if (issue.errors.includes('price')) counts.invalidPrice++;
    if (issue.errors.includes('title')) counts.missingTitle++;
    if (issue.errors.includes('link')) counts.missingLink++;
    if (issue.errors.includes('description')) counts.missingDescription++;
    if (issue.warnings.includes('brand_or_gtin')) counts.noBrandNoGtin++;
    if (!item.gtin || item.gtin.trim().length === 0) counts.missingGtin++;

    const hasErr = issue.errors.length > 0;
    const hasWarn = issue.warnings.length > 0;
    if (hasErr) itemsWithErrors++;
    if (hasWarn) itemsWithWarnings++;
    if (!hasErr && !hasWarn) okItems++;

    // Sample: errors eerst (tot SAMPLE_LIMIT), daarna warning-only items.
    if (hasErr && sample.length < SAMPLE_LIMIT) sample.push(issue);
    else if (!hasErr && hasWarn && warnSample.length < SAMPLE_LIMIT) warnSample.push(issue);
  }

  // Vul de sample aan met warning-only items als er ruimte over is.
  for (const w of warnSample) {
    if (sample.length >= SAMPLE_LIMIT) break;
    sample.push(w);
  }

  return {
    shopId,
    totalItems: items.length,
    okItems,
    itemsWithErrors,
    itemsWithWarnings,
    counts,
    sample,
  };
}
