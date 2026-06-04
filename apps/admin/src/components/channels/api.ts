/**
 * React-Query hooks + DTO-types voor het channels-domein.
 *
 * Bron-of-waarheid voor shapes = backend serializers
 * (`apps/api/src/routes/channels/_serialize.ts`) + route-index
 * (`apps/api/src/routes/channels/index.ts`).
 *
 * KRITISCH:
 *   - Channels zijn NIET shop-scoped (geen shop_id query-param) — het zijn
 *     globale sales-channel-connecties.
 *   - Credentials komen NOOIT raw terug: `credentials` is een presence-map
 *     (`{ clientId: 'set' | null, ... }`) + `hasCredentials: boolean`.
 *   - Geld (priceOverride) blijft een decimal-STRING (Money), nooit number.
 *   - List geeft detail-DTO's terug (inclusief `counts`).
 *
 * Conventie (zie components/orders/api.ts): hooks per feature, queryKeys met
 * filters, mutations invalideren de list-key.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── DTO-types (mirror van backend _serialize.ts) ──────────────

export type ChannelType = 'own_webshop' | 'bol' | 'amazon' | 'gmc';
export type ChannelStatus = 'disconnected' | 'connected' | 'error';

export interface ChannelDto {
  id: string;
  type: string;
  name: string;
  status: string;
  /** Presence-map per credential-veld — NOOIT de raw waarde. */
  credentials: Record<string, 'set' | null>;
  /** True als er ueberhaupt versleutelde credentials opgeslagen zijn. */
  hasCredentials: boolean;
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelDetailDto extends ChannelDto {
  counts: {
    products: number;
    orders: number;
  };
}

export interface ChannelProductDto {
  id: string;
  channelId: string;
  productId: string;
  variantId: string | null;
  externalId: string | null;
  status: string;
  /** Afgeleid uit status: active/enabled/listed = listed. */
  enabled: boolean;
  priceOverride: string | null;
  lastSyncedAt: string | null;
  product?: {
    id: string;
    title: string;
    sku: string | null;
  } | null;
}

export interface ChannelListResponse {
  items: ChannelDetailDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface ChannelProductsResponse {
  channelId: string;
  items: ChannelProductDto[];
  total: number;
}

export interface TestConnectionResponse {
  ok: boolean;
  detail: string;
  channel: ChannelDetailDto;
}

export interface SyncChannelResponse {
  ordersImported: number;
  listingsPushed: number;
  errors: string[];
}

// ─── Filters ───────────────────────────────────────────────────

export interface ChannelListFilters {
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export const CHANNELS_QUERY_KEYS = {
  all: ['channels'] as const,
  list: (filters: ChannelListFilters) => ['channels', 'list', filters] as const,
  detail: (id: string) => ['channels', 'detail', id] as const,
  products: (id: string, enabledOnly: boolean) =>
    ['channels', 'products', id, enabledOnly] as const,
};

// ─── List ──────────────────────────────────────────────────────

export function useChannels(filters: ChannelListFilters = {}) {
  return useQuery({
    queryKey: CHANNELS_QUERY_KEYS.list(filters),
    queryFn: async (): Promise<ChannelListResponse> => {
      const res = await api.get<ChannelListResponse>('/channels', {
        params: {
          type: filters.type || undefined,
          status: filters.status || undefined,
          limit: filters.limit,
          offset: filters.offset,
        },
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

// ─── Detail ────────────────────────────────────────────────────

export function useChannel(id: string | undefined) {
  return useQuery({
    queryKey: CHANNELS_QUERY_KEYS.detail(id ?? '__none__'),
    queryFn: async (): Promise<ChannelDetailDto> => {
      const res = await api.get<{ channel: ChannelDetailDto }>(`/channels/${id}`);
      return res.data.channel;
    },
    enabled: !!id,
  });
}

// ─── Channel products (matrix-bron per kanaal) ─────────────────

export function useChannelProducts(id: string | undefined, enabledOnly = false) {
  return useQuery({
    queryKey: CHANNELS_QUERY_KEYS.products(id ?? '__none__', enabledOnly),
    queryFn: async (): Promise<ChannelProductsResponse> => {
      const res = await api.get<ChannelProductsResponse>(`/channels/${id}/products`, {
        params: { enabledOnly: enabledOnly ? 'true' : undefined },
      });
      return res.data;
    },
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

// ─── Mutations ─────────────────────────────────────────────────

export interface CreateChannelInput {
  type: ChannelType;
  name: string;
  config?: Record<string, unknown>;
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateChannelInput): Promise<ChannelDetailDto> => {
      const res = await api.post<{ channel: ChannelDetailDto }>('/channels', input);
      return res.data.channel;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEYS.all });
    },
  });
}

export interface UpdateChannelInput {
  name?: string;
  config?: Record<string, unknown>;
  status?: ChannelStatus;
}

export function useUpdateChannel(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateChannelInput): Promise<ChannelDetailDto> => {
      const res = await api.patch<{ channel: ChannelDetailDto }>(
        `/channels/${channelId}`,
        input,
      );
      return res.data.channel;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEYS.all });
    },
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (channelId: string): Promise<{ ok: boolean; id: string }> => {
      const res = await api.delete<{ ok: boolean; id: string }>(`/channels/${channelId}`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEYS.all });
    },
  });
}

/**
 * PUT /:id/credentials — encrypt + store. Body-shape per channel-type:
 *   bol    : { clientId, clientSecret }
 *   amazon : { refreshToken, clientId, clientSecret, marketplaceId?, sellerId?, region? }
 *   gmc    : { merchantId, serviceAccountJson }
 *   own_webshop heeft GEEN credentials (gebruik useUpdateChannel voor config).
 */
export function useSetCredentials(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      credentials: Record<string, string>,
    ): Promise<ChannelDetailDto> => {
      const res = await api.put<{ channel: ChannelDetailDto }>(
        `/channels/${channelId}/credentials`,
        credentials,
      );
      return res.data.channel;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEYS.all });
    },
  });
}

export function useTestConnection(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<TestConnectionResponse> => {
      const res = await api.post<TestConnectionResponse>(
        `/channels/${channelId}/test-connection`,
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEYS.all });
    },
  });
}

export function useSyncChannel(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<SyncChannelResponse> => {
      const res = await api.post<SyncChannelResponse>(`/channels/${channelId}/sync`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEYS.all });
    },
  });
}

export interface ToggleChannelProductInput {
  channelId: string;
  variantId: string;
  enabled?: boolean;
  priceOverride?: string | null;
}

/**
 * PUT /:id/products/:variantId — enable/disable + optional priceOverride.
 * Bij niet-connected marketplace geeft de backend 409 channel_not_connected;
 * de caller toont dat als toast (zie matrix-page).
 */
export function useToggleChannelProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: ToggleChannelProductInput,
    ): Promise<ChannelProductDto> => {
      const body: { enabled?: boolean; priceOverride?: string | null } = {};
      if (input.enabled !== undefined) body.enabled = input.enabled;
      if (input.priceOverride !== undefined) body.priceOverride = input.priceOverride;
      const res = await api.put<{ channelProduct: ChannelProductDto }>(
        `/channels/${input.channelId}/products/${input.variantId}`,
        body,
      );
      return res.data.channelProduct;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['channels', 'products', vars.channelId],
      });
      void qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEYS.all });
    },
  });
}

// ─── Presentational helpers ────────────────────────────────────

export const CHANNEL_TYPE_META: Record<
  string,
  { label: string; kind: string; accent: string; letter: string }
> = {
  own_webshop: { label: 'Eigen webshop', kind: 'Eigen storefront', accent: '#ff9f43', letter: 'W' },
  bol: { label: 'Bol.com', kind: 'Marketplace', accent: '#0000a4', letter: 'B' },
  amazon: { label: 'Amazon', kind: 'Marketplace', accent: '#ff9900', letter: 'A' },
  gmc: { label: 'Google Shopping', kind: 'Feed', accent: '#4285f4', letter: 'G' },
};

export function channelTypeMeta(type: string) {
  return (
    CHANNEL_TYPE_META[type] ?? {
      label: type,
      kind: 'Kanaal',
      accent: 'var(--theme-accent)',
      letter: (type[0] ?? '?').toUpperCase(),
    }
  );
}
