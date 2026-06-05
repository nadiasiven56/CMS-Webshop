/**
 * React-Query hooks + DTO-types voor het marketing/feeds-domein.
 *
 * Bron-of-waarheid voor shapes = backend serializers
 * (`apps/api/src/routes/feeds/_serialize.ts`) + route-index
 * (`apps/api/src/routes/feeds/index.ts`) + REGISTER.md.
 *
 * KRITISCH:
 *   - Analytics-config + feed-configs zijn PER SHOP (shop_id verplicht als
 *     query-param). De UI kiest de shop via de shop-context/-selector.
 *   - De publieke feed-/analytics-URLs (`publicFeedUrl` / `publicAnalyticsUrl`)
 *     komen ABSOLUUT terug uit de backend (PUBLIC_BASE_URL). De UI biedt óók een
 *     window.location.origin-variant aan zodat de operator dezelfde origin als de
 *     admin gebruikt — zie buildOriginUrl in marketing.index.tsx.
 *   - GET /analytics geeft `{ analytics: dto | null }` terug — null = nog geen rij;
 *     de UI toont dan een leeg formulier en PUT maakt de rij aan.
 *
 * Conventie (zie components/channels/api.ts): hooks per feature, queryKeys met
 * filters, mutations invalideren de relevante list-key.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── DTO-types (mirror van backend _serialize.ts) ──────────────

export type FeedChannel = 'google_shopping' | 'meta';

export interface AnalyticsConfigDto {
  id: string;
  shopId: string;
  ga4MeasurementId: string | null;
  metaPixelId: string | null;
  googleAdsId: string | null;
  googleAdsConversionLabel: string | null;
  clarityProjectId: string | null;
  customHeadHtml: string | null;
  enabled: boolean;
  /** Publieke analytics.json-URL die de storefront-SDK ophaalt (absoluut). */
  publicAnalyticsUrl: string;
  /** Publieke tags.js-URL: één scripttag in de storefront laadt alle tags (absoluut). */
  publicTagsUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedConfigDto {
  id: string;
  shopId: string;
  channel: string;
  enabled: boolean;
  includeOutOfStock: boolean;
  currency: string;
  config: Record<string, unknown>;
  lastBuiltAt: string | null;
  /** Publieke feed-URL voor dit channel (plak in GMC / Meta) — absoluut. */
  publicFeedUrl: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Response-envelopes ────────────────────────────────────────

interface AnalyticsResponse {
  analytics: AnalyticsConfigDto | null;
  shopId?: string;
}

interface FeedConfigsResponse {
  shopId: string;
  items: FeedConfigDto[];
  total: number;
}

interface RebuildResponse {
  config: FeedConfigDto;
  itemCount: number;
}

// ─── Query-keys ────────────────────────────────────────────────

export const MARKETING_QUERY_KEYS = {
  all: ['marketing'] as const,
  analytics: (shopId: string | null) => ['marketing', 'analytics', shopId] as const,
  feedConfigs: (shopId: string | null) => ['marketing', 'feed-configs', shopId] as const,
};

// ─── Analytics-config (per shop) ───────────────────────────────

export function useAnalyticsConfig(shopId: string | null) {
  return useQuery({
    queryKey: MARKETING_QUERY_KEYS.analytics(shopId),
    queryFn: async (): Promise<AnalyticsConfigDto | null> => {
      const res = await api.get<AnalyticsResponse>('/feeds/analytics', {
        params: { shop_id: shopId },
      });
      return res.data.analytics;
    },
    enabled: !!shopId,
    staleTime: 30_000,
  });
}

export interface UpsertAnalyticsInput {
  ga4MeasurementId?: string | null;
  metaPixelId?: string | null;
  googleAdsId?: string | null;
  googleAdsConversionLabel?: string | null;
  clarityProjectId?: string | null;
  customHeadHtml?: string | null;
  enabled?: boolean;
}

export function useUpsertAnalyticsConfig(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertAnalyticsInput): Promise<AnalyticsConfigDto> => {
      const res = await api.put<{ analytics: AnalyticsConfigDto }>(
        '/feeds/analytics',
        input,
        { params: { shop_id: shopId } },
      );
      return res.data.analytics;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MARKETING_QUERY_KEYS.analytics(shopId) });
    },
  });
}

// ─── Feed-configs (per shop, per channel) ──────────────────────

export function useFeedConfigs(shopId: string | null) {
  return useQuery({
    queryKey: MARKETING_QUERY_KEYS.feedConfigs(shopId),
    queryFn: async (): Promise<FeedConfigDto[]> => {
      const res = await api.get<FeedConfigsResponse>('/feeds/configs', {
        params: { shop_id: shopId },
      });
      return res.data.items ?? [];
    },
    enabled: !!shopId,
    staleTime: 30_000,
  });
}

export interface UpsertFeedConfigInput {
  channel: FeedChannel;
  enabled?: boolean;
  includeOutOfStock?: boolean;
  currency?: string;
  config?: Record<string, unknown>;
}

export function useUpsertFeedConfig(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertFeedConfigInput): Promise<FeedConfigDto> => {
      const res = await api.put<{ config: FeedConfigDto }>(
        '/feeds/configs',
        input,
        { params: { shop_id: shopId } },
      );
      return res.data.config;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MARKETING_QUERY_KEYS.feedConfigs(shopId) });
    },
  });
}

/**
 * POST /feeds/configs/:id/rebuild — markeert last_built_at en geeft het actuele
 * item-aantal terug (zelfde bron als de publieke feed). Invalideert de
 * feed-configs zodat lastBuiltAt direct ververst.
 */
export function useRebuildFeed(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (configId: string): Promise<RebuildResponse> => {
      const res = await api.post<RebuildResponse>(`/feeds/configs/${configId}/rebuild`, {});
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MARKETING_QUERY_KEYS.feedConfigs(shopId) });
    },
  });
}

// ─── Feed-validatie (GMC verplichte velden) ────────────────────

export interface FeedValidationIssue {
  itemId: string;
  title: string;
  errors: string[];
  warnings: string[];
}

export interface FeedValidationReport {
  shopId: string;
  totalItems: number;
  okItems: number;
  itemsWithErrors: number;
  itemsWithWarnings: number;
  counts: {
    missingImageLink: number;
    invalidPrice: number;
    missingTitle: number;
    missingLink: number;
    missingDescription: number;
    noBrandNoGtin: number;
    missingGtin: number;
  };
  sample: FeedValidationIssue[];
}

/**
 * GET /feeds/configs/validate — checkt of de producten de door Google Merchant
 * Center verplichte velden hebben. Op-aanvraag (knop) → useMutation.
 */
export function useValidateFeed(shopId: string | null) {
  return useMutation({
    mutationFn: async (): Promise<FeedValidationReport> => {
      const res = await api.get<{ report: FeedValidationReport }>('/feeds/configs/validate', {
        params: { shop_id: shopId },
      });
      return res.data.report;
    },
  });
}

// ─── Presentational helpers ────────────────────────────────────

export const FEED_CHANNEL_META: Record<
  FeedChannel,
  { label: string; kind: string; accent: string; letter: string; hint: string }
> = {
  google_shopping: {
    label: 'Google Shopping',
    kind: 'Product-feed',
    accent: '#4285f4',
    letter: 'G',
    hint: 'Plak deze URL in Google Merchant Center → Products → Feeds → "Scheduled fetch".',
  },
  meta: {
    label: 'Meta (Facebook / Instagram)',
    kind: 'Catalog-feed',
    accent: '#0866ff',
    letter: 'M',
    hint: 'Plak deze URL in Meta Commerce Manager → Catalog → Data sources → "Scheduled feed".',
  },
};

/** De vaste set feed-channels die de UI altijd toont (ook zonder rij). */
export const FEED_CHANNELS: FeedChannel[] = ['google_shopping', 'meta'];

export function feedChannelMeta(channel: string) {
  return (
    FEED_CHANNEL_META[channel as FeedChannel] ?? {
      label: channel,
      kind: 'Feed',
      accent: 'var(--theme-accent)',
      letter: (channel[0] ?? '?').toUpperCase(),
      hint: 'Plak deze URL in het bijbehorende kanaal.',
    }
  );
}
