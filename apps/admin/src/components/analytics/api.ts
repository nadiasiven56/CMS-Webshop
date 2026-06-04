/**
 * React-Query hooks + DTO-types voor de analytics/BI-module (`/api/analytics/*`).
 *
 * Bron-of-waarheid voor shapes = backend route-index
 * (`apps/api/src/routes/analytics/index.ts`) + REGISTER.md.
 *
 * KRITISCH:
 *   - Alle bedragen komen als Money-STRING ('1234.5600') — NOOIT number.
 *     Renderen via parseMoney + Intl in de page.
 *   - Alle endpoints delen één filters-object (shopId/channel/from/to/interval).
 *     shopId weglaten = aggregeer over ALLE shops. interval default 'day'.
 *   - Snake_case query-params (shop_id, from, to, interval, channel, limit,
 *     threshold). De queryKey bevat de filters zodat een filter-wissel herquerient.
 *
 * Conventie (zie components/dashboard/api.ts): hooks per endpoint, gedeelde
 * filters in de queryKey, staleTime zodat filter-wissels niet flikkeren.
 */
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── Gedeelde filters ──────────────────────────────────────────

export type AnalyticsInterval = 'day' | 'week' | 'month';

export interface AnalyticsFilters {
  /** Actieve shop-id (UUID). null/undefined = aggregeer over ALLE shops. */
  shopId?: string | null;
  /** Kanaal-slug (web/bol/amazon/…). undefined = alle kanalen. */
  channel?: string;
  /** YYYY-MM-DD. Overschrijven het default 30-daags venster. */
  from?: string;
  to?: string;
  /** date_trunc-granulariteit voor de tijdreeks. Default 'day'. */
  interval?: AnalyticsInterval;
}

/** Snake_case query-params die alle endpoints delen. */
function baseParams(f: AnalyticsFilters) {
  return {
    shop_id: f.shopId ?? undefined,
    channel: f.channel || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    interval: f.interval || undefined,
  };
}

export const ANALYTICS_QUERY_KEYS = {
  all: ['analytics'] as const,
  salesOverTime: (f: AnalyticsFilters) => ['analytics', 'sales-over-time', f] as const,
  topProducts: (f: AnalyticsFilters, limit: number) =>
    ['analytics', 'top-products', f, limit] as const,
  kpis: (f: AnalyticsFilters) => ['analytics', 'kpis', f] as const,
  channelBreakdown: (f: AnalyticsFilters) => ['analytics', 'channel-breakdown', f] as const,
  shopBreakdown: (f: AnalyticsFilters) => ['analytics', 'shop-breakdown', f] as const,
  lowStock: (shopId: string | null | undefined, threshold: number) =>
    ['analytics', 'low-stock', shopId ?? null, threshold] as const,
  topCustomers: (f: AnalyticsFilters, limit: number) =>
    ['analytics', 'customers-top', f, limit] as const,
};

// ─── DTO-types (mirror van backend responses) ──────────────────

export interface SalesPoint {
  period: string;
  orders: number;
  revenue: string;
  units: number;
}

export interface SalesOverTimeResponse {
  series: SalesPoint[];
  totals: { orders: number; revenue: string; units: number };
  interval: string;
}

export interface TopProduct {
  productId: string | null;
  variantId: string | null;
  title: string;
  sku: string | null;
  unitsSold: number;
  revenue: string;
}

export interface AnalyticsKpis {
  revenue: string;
  orders: number;
  aov: string;
  units: number;
  refunds: string;
  newCustomers: number;
}

export interface ChannelBreakdownItem {
  channel: string;
  orders: number;
  revenue: string;
  share: number;
}

export interface ShopBreakdownItem {
  shopId: string;
  shop: string;
  orders: number;
  revenue: string;
  share: number;
}

export interface LowStockItem {
  productId: string | null;
  variantId: string | null;
  title: string;
  sku: string | null;
  available: number;
  reorderSuggested: number;
}

export interface TopCustomer {
  customerId: string | null;
  email: string;
  orders: number;
  revenue: string;
}

// ─── Hooks ─────────────────────────────────────────────────────

export function useSalesOverTime(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: ANALYTICS_QUERY_KEYS.salesOverTime(filters),
    queryFn: async (): Promise<SalesOverTimeResponse> => {
      const res = await api.get<SalesOverTimeResponse>('/analytics/sales-over-time', {
        params: baseParams(filters),
      });
      return res.data;
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useTopProducts(filters: AnalyticsFilters, limit = 10) {
  return useQuery({
    queryKey: ANALYTICS_QUERY_KEYS.topProducts(filters, limit),
    queryFn: async (): Promise<TopProduct[]> => {
      const res = await api.get<{ items: TopProduct[] }>('/analytics/top-products', {
        params: { ...baseParams(filters), limit },
      });
      return res.data.items ?? [];
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useAnalyticsKpis(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: ANALYTICS_QUERY_KEYS.kpis(filters),
    queryFn: async (): Promise<AnalyticsKpis> => {
      const res = await api.get<AnalyticsKpis>('/analytics/kpis', {
        params: baseParams(filters),
      });
      return res.data;
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useChannelBreakdown(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: ANALYTICS_QUERY_KEYS.channelBreakdown(filters),
    queryFn: async (): Promise<ChannelBreakdownItem[]> => {
      const res = await api.get<{ items: ChannelBreakdownItem[] }>(
        '/analytics/channel-breakdown',
        { params: baseParams(filters) },
      );
      return res.data.items ?? [];
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useShopBreakdown(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: ANALYTICS_QUERY_KEYS.shopBreakdown(filters),
    queryFn: async (): Promise<ShopBreakdownItem[]> => {
      const res = await api.get<{ items: ShopBreakdownItem[] }>('/analytics/shop-breakdown', {
        params: baseParams(filters),
      });
      return res.data.items ?? [];
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * /low-stock — alleen shop_id + threshold zijn relevant (voorraad is in V1
 * shop-overstijgend; channel/date filteren niet). We sturen daarom enkel die mee.
 */
export function useLowStock(filters: AnalyticsFilters, threshold = 5) {
  return useQuery({
    queryKey: ANALYTICS_QUERY_KEYS.lowStock(filters.shopId, threshold),
    queryFn: async (): Promise<LowStockItem[]> => {
      const res = await api.get<{ items: LowStockItem[]; threshold: number }>(
        '/analytics/low-stock',
        { params: { shop_id: filters.shopId ?? undefined, threshold } },
      );
      return res.data.items ?? [];
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useTopCustomers(filters: AnalyticsFilters, limit = 10) {
  return useQuery({
    queryKey: ANALYTICS_QUERY_KEYS.topCustomers(filters, limit),
    queryFn: async (): Promise<TopCustomer[]> => {
      const res = await api.get<{ items: TopCustomer[] }>('/analytics/customers/top', {
        params: { ...baseParams(filters), limit },
      });
      return res.data.items ?? [];
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

// ─── Money-helpers (STRING → number, alleen voor weergave/charts) ──

/** Parse een Money-STRING ('1234.5600') naar een number. NaN → 0. */
export function parseMoney(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
