/**
 * Serializers — Drizzle-row → API-DTO voor de feeds/marketing-module.
 *
 * Conventie (zie channels/shops `_serialize.ts`):
 *   - timestamps → ISO-string
 *   - jsonb (config) shape stabiel houden
 *   - publieke feed-URLs worden HIER berekend zodat de admin-UI ze direct kan
 *     tonen (operator plakt ze in Google Merchant Center / Meta).
 */
import type {
  StorefrontAnalytics,
  FeedConfig,
} from '../../db/schema/marketing.js';
import { publicBaseUrl } from '../../domain/feeds/build.js';

// ─── storefront_analytics ────────────────────────────────────

export interface AnalyticsDto {
  id: string;
  shopId: string;
  ga4MeasurementId: string | null;
  metaPixelId: string | null;
  googleAdsId: string | null;
  googleAdsConversionLabel: string | null;
  clarityProjectId: string | null;
  customHeadHtml: string | null;
  enabled: boolean;
  /** Publieke analytics.json-URL die de storefront-SDK ophaalt. */
  publicAnalyticsUrl: string;
  /** Publieke tags.js-URL: één scripttag in de storefront laadt alle tags. */
  publicTagsUrl: string;
  createdAt: string;
  updatedAt: string;
}

export function toAnalyticsDto(a: StorefrontAnalytics, baseUrl?: string): AnalyticsDto {
  const base = (baseUrl ?? publicBaseUrl()).replace(/\/+$/, '');
  return {
    id: a.id,
    shopId: a.shopId,
    ga4MeasurementId: a.ga4MeasurementId,
    metaPixelId: a.metaPixelId,
    googleAdsId: a.googleAdsId,
    googleAdsConversionLabel: a.googleAdsConversionLabel,
    clarityProjectId: a.clarityProjectId,
    customHeadHtml: a.customHeadHtml,
    enabled: a.enabled,
    publicAnalyticsUrl: `${base}/api/feeds/public/${a.shopId}/analytics.json`,
    publicTagsUrl: `${base}/api/feeds/public/${a.shopId}/tags.js`,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/**
 * Publieke analytics-payload die de storefront nodig heeft om de tags te
 * renderen. Bevat ALLEEN non-null ids en alleen wanneer `enabled`. Bij
 * disabled/lege rij → alle velden null + enabled:false (storefront rendert
 * dan niets).
 */
export interface PublicAnalyticsDto {
  enabled: boolean;
  ga4MeasurementId: string | null;
  metaPixelId: string | null;
  googleAdsId: string | null;
  googleAdsConversionLabel: string | null;
  clarityProjectId: string | null;
  customHeadHtml: string | null;
}

export function toPublicAnalyticsDto(
  a: StorefrontAnalytics | null,
): PublicAnalyticsDto {
  if (!a || !a.enabled) {
    return {
      enabled: false,
      ga4MeasurementId: null,
      metaPixelId: null,
      googleAdsId: null,
      googleAdsConversionLabel: null,
      clarityProjectId: null,
      customHeadHtml: null,
    };
  }
  return {
    enabled: true,
    ga4MeasurementId: a.ga4MeasurementId,
    metaPixelId: a.metaPixelId,
    googleAdsId: a.googleAdsId,
    googleAdsConversionLabel: a.googleAdsConversionLabel,
    clarityProjectId: a.clarityProjectId,
    customHeadHtml: a.customHeadHtml,
  };
}

// ─── feed_config ─────────────────────────────────────────────

export interface FeedConfigDto {
  id: string;
  shopId: string;
  channel: string;
  enabled: boolean;
  includeOutOfStock: boolean;
  currency: string;
  config: Record<string, unknown>;
  lastBuiltAt: string | null;
  /** Publieke feed-URL voor dit channel (plak in GMC / Meta). */
  publicFeedUrl: string;
  createdAt: string;
  updatedAt: string;
}

/** Channel → publiek feed-pad (bestand-extensie matcht de content-type). */
export function feedPublicPath(shopId: string, channel: string): string {
  if (channel === 'meta') return `/api/feeds/public/${shopId}/meta.csv`;
  // default google_shopping
  return `/api/feeds/public/${shopId}/google.xml`;
}

export function toFeedConfigDto(f: FeedConfig, baseUrl?: string): FeedConfigDto {
  const base = (baseUrl ?? publicBaseUrl()).replace(/\/+$/, '');
  return {
    id: f.id,
    shopId: f.shopId,
    channel: f.channel,
    enabled: f.enabled,
    includeOutOfStock: f.includeOutOfStock,
    currency: f.currency,
    config: (f.config ?? {}) as Record<string, unknown>,
    lastBuiltAt: f.lastBuiltAt ? f.lastBuiltAt.toISOString() : null,
    publicFeedUrl: `${base}${feedPublicPath(f.shopId, f.channel)}`,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}
