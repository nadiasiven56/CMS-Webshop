/**
 * Genormaliseerde feed-types — gedeeld door de Google- en Meta-renderers.
 *
 * Een {@link FeedItem} is één rij in een product-feed: de bron is altijd een
 * GEPUBLICEERDE variant in een actieve shop (zelfde bron als de storefront —
 * zie build.ts). Prijs is een STRING (Money, nooit float). availability +
 * condition volgen de Google/Meta-vocabulaire zodat de renderers alleen hoeven
 * te formatteren, niet te beslissen.
 */

/** Google/Meta availability-vocabulaire. */
export type FeedAvailability = 'in_stock' | 'out_of_stock';

/** Google/Meta condition-vocabulaire. V1 = altijd 'new'. */
export type FeedCondition = 'new' | 'refurbished' | 'used';

/**
 * Eén feed-regel. `id` is de stabiele item-id die Google/Meta gebruikt om
 * updates te matchen — wij gebruiken de variant-SKU (uniek) als die er is,
 * anders de variant-id.
 */
export interface FeedItem {
  /** Stabiele item-id voor de feed (SKU of variant-id). */
  id: string;
  /** Variant-SKU (kan gelijk zijn aan id). */
  sku: string;
  title: string;
  /** Plain-text omschrijving (HTML gestript door build.ts). */
  description: string;
  /** Absolute product-detail-URL op de storefront. */
  link: string;
  /** Absolute primary-image-URL (of leeg als geen image). */
  imageLink: string;
  /** Prijs als decimal-STRING (Money), bv. '19.9900'. */
  price: string;
  /** ISO-4217 currency, bv. 'EUR'. */
  currency: string;
  availability: FeedAvailability;
  condition: FeedCondition;
  /** Merk/vendor — leeg als onbekend. */
  brand: string;
  /** GTIN/EAN/UPC barcode — optioneel. */
  gtin?: string;
  /** Vrije productType/categorie-string — leeg als onbekend. */
  productType: string;
}

/** Subset van de shop die de renderers nodig hebben (titel/link-basis). */
export interface FeedShop {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  currency: string;
}

/** Opties voor het laden van feed-items. */
export interface BuildFeedOpts {
  /** Neem ook out-of-stock varianten mee (default false). */
  includeOutOfStock?: boolean;
  /** Forceer een currency (anders shop.currency). */
  currency?: string;
  /** Override de publieke basis-URL voor link/imageLink (anders PUBLIC_BASE_URL). */
  baseUrl?: string;
}

/** Resultaat van een rendered feed — direct als HTTP-body bruikbaar. */
export interface RenderedFeed {
  contentType: string;
  body: string;
  /** Aantal items in de feed (handig voor /rebuild-response + logging). */
  itemCount: number;
}
