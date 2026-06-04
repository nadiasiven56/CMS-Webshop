/**
 * React-Query hooks + DTO-types voor het locations-domein.
 *
 * Bron-of-waarheid voor shapes = backend serializer
 * (`apps/api/src/routes/locations/_serialize.ts`). Locaties zijn GLOBAL
 * (niet shop-scoped) — er is geen `shop_id`-param. `code` is uniek
 * (409 `code_taken` bij clash). `priority` bepaalt fulfillment-volgorde
 * (lager = eerder). Adres is een jsonb-object (line1/line2/postcode/city/country).
 *
 * Endpoints:
 *   GET    /api/locations        — list (paginate + filter active/search)
 *   POST   /api/locations        — create  → { location }
 *   PATCH  /api/locations/:id    — partial update → { location }
 *   DELETE /api/locations/:id    — delete → { ok, id }
 */
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── DTO-types (mirror van backend _serialize.ts) ──────────────

export interface LocationAddress {
  line1?: string;
  line2?: string;
  postcode?: string;
  city?: string;
  country?: string;
  [key: string]: unknown;
}

export interface LocationDto {
  id: string;
  code: string;
  name: string;
  type: string;
  priority: number;
  address: LocationAddress | null;
  active: boolean;
  createdAt: string;
}

export interface LocationListResponse {
  items: LocationDto[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Filters ───────────────────────────────────────────────────

export interface LocationListFilters {
  active?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export const LOCATIONS_QUERY_KEYS = {
  all: ['locations'] as const,
  list: (filters: LocationListFilters) => ['locations', 'list', filters] as const,
  detail: (id: string) => ['locations', 'detail', id] as const,
};

// ─── List ──────────────────────────────────────────────────────

export function useLocations(filters: LocationListFilters = {}) {
  return useQuery({
    queryKey: LOCATIONS_QUERY_KEYS.list(filters),
    queryFn: async (): Promise<LocationListResponse> => {
      const res = await api.get<LocationListResponse>('/locations', {
        params: {
          active: filters.active === undefined ? undefined : filters.active,
          search: filters.search || undefined,
          limit: filters.limit ?? 200,
          offset: filters.offset ?? 0,
        },
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

// ─── Mutations ─────────────────────────────────────────────────

export interface LocationWriteInput {
  code: string;
  name: string;
  type?: string;
  priority?: number;
  address?: LocationAddress | null;
  active?: boolean;
}

export function useCreateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LocationWriteInput): Promise<LocationDto> => {
      const res = await api.post<{ location: LocationDto }>('/locations', input);
      return res.data.location;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEYS.all });
    },
  });
}

export type LocationUpdateInput = Partial<LocationWriteInput>;

export function useUpdateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: LocationUpdateInput;
    }): Promise<LocationDto> => {
      const res = await api.patch<{ location: LocationDto }>(`/locations/${id}`, patch);
      return res.data.location;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEYS.all });
    },
  });
}

export function useDeleteLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ ok: boolean; id: string }> => {
      const res = await api.delete<{ ok: boolean; id: string }>(`/locations/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEYS.all });
    },
  });
}
