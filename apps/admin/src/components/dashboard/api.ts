/**
 * React-Query hooks + DTO-types voor het dashboard-domein.
 *
 * Bron-of-waarheid voor de KPI-shape = backend serializer
 * (`apps/api/src/routes/dashboard/_serialize.ts` → `DashboardKpis`). De admin
 * consumeert `GET /api/dashboard/kpis` 1-op-1. Geldbedragen in de KPI-DTO zijn
 * `number` (euro's) i.p.v. Money-strings, omdat charts/sparklines numbers
 * verwachten — dit is bewust zo in de backend-DTO.
 *
 * Filters: `shop_id` (UUID; weglaten = ALLE shops), `channel` (web/bol/amazon/…),
 * optioneel `from`/`to` (YYYY-MM-DD). Snake_case query-params. De queryKey bevat
 * de filters zodat een filter-wissel automatisch herquerient.
 *
 * Channels-sync hangt aan de echte `/api/channels/:id/sync`-route; de dashboard
 * quick-actions repointen daarop i.p.v. de oude mock-only fake-buttons.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── DTO — EXACT de backend dashboard-shape ────────────────────

export interface DashboardKpis {
  revenue30d: number;
  revenue30dDelta: number; // pct vs vorige periode
  revenueSeries: Array<{ day: string; revenue: number }>;
  openOrders: number;
  openOrdersUnpaid: number;
  openOrdersToShip: number;
  lowStockCount: number;
  lowStockTop: Array<{ sku: string; available: number; productTitle: string }>;
  topProducts: Array<{ title: string; revenue: number }>;
  channels: Array<{ name: string; status: 'connected' | 'warning' | 'error'; lastSync: string }>;
  recentActivity: Array<{
    id: string;
    type: 'order' | 'stock' | 'login' | 'product';
    actor: string;
    text: string;
    timestamp: string;
  }>;
}

// ─── Filters ───────────────────────────────────────────────────

export interface DashboardFilters {
  /** Actieve shop-id (UUID). null/undefined = aggregeer over ALLE shops. */
  shopId?: string | null;
  /** Kanaal-slug (web/bol/amazon/…). undefined = alle kanalen. */
  channel?: string;
  /** YYYY-MM-DD. Overschrijven het default 30-daags venster. */
  from?: string;
  to?: string;
}

export const DASHBOARD_QUERY_KEYS = {
  all: ['dashboard'] as const,
  kpis: (filters: DashboardFilters) => ['dashboard', 'kpis', filters] as const,
};

// ─── KPIs ──────────────────────────────────────────────────────

export function useDashboardKpis(filters: DashboardFilters) {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.kpis(filters),
    queryFn: async (): Promise<DashboardKpis> => {
      const res = await api.get<DashboardKpis>('/dashboard/kpis', {
        params: {
          shop_id: filters.shopId ?? undefined,
          channel: filters.channel || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
        },
      });
      return res.data;
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

// ─── Channels (voor de sync-actie in quick-actions) ────────────

export interface ChannelListItem {
  id: string;
  type: string;
  name: string;
  status: string;
  lastSyncAt: string | null;
}

interface ChannelListResponse {
  items: ChannelListItem[];
  total: number;
}

export function useChannelOptions() {
  return useQuery({
    queryKey: ['dashboard', 'channel-options'] as const,
    queryFn: async (): Promise<ChannelListItem[]> => {
      const res = await api.get<ChannelListResponse>('/channels', {
        params: { limit: 100 },
      });
      return res.data.items ?? [];
    },
    staleTime: 60_000,
  });
}

export interface ChannelSyncResult {
  ordersImported: number;
  listingsPushed: number;
  errors: string[];
}

/**
 * POST /api/channels/:id/sync — echte sync (own_webshop importeert orders +
 * pusht inventory; marketplaces geven 409 channel_not_connected zonder creds).
 * Bij succes invalideren we de dashboard-KPIs zodat de cijfers verversen.
 */
export function useSyncChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (channelId: string): Promise<ChannelSyncResult> => {
      const res = await api.post<ChannelSyncResult>(`/channels/${channelId}/sync`, {});
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.all });
      void qc.invalidateQueries({ queryKey: ['dashboard', 'channel-options'] });
    },
  });
}
