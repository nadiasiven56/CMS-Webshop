/**
 * React-Query hooks + DTO-types voor het returns/RMA-domein.
 *
 * Bron-of-waarheid voor shapes = backend serializers
 * (`apps/api/src/routes/orders/_serialize.ts` → toReturnDto). Geld blijft string.
 * Top-level RMA-board is shop-scoped via `shop_id` (snake_case query-param).
 * De queryKeys bevatten `activeShopId` zodat shop-wissel automatisch herquerient
 * en `filters` zodat status-tab-wissel een nieuwe query triggert.
 *
 * Endpoints (zie apps/api/src/routes/orders/index.ts → returnsRoutes):
 *   GET    /api/returns          — board (filter shop_id/order_id/status, paginate)
 *   GET    /api/returns/:rid     — detail (incl. return_items)
 *   POST   /api/returns          — create (shopId of orderId verplicht)
 *   PATCH  /api/returns/:rid     — update status / reason / refundAmount
 *
 * NB: een return-item met `restock === true` op een return die `refunded` is,
 * is door de backend AUTOMATISCH teruggeboekt naar voorraad (zie
 * applyRefundEffects in returns.ts). De UI surfacet dit als "teruggeboekt".
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ReturnDto, ReturnItemDto } from '@/components/orders/api';

export type { ReturnDto, ReturnItemDto } from '@/components/orders/api';

export type ReturnStatus =
  | 'requested'
  | 'approved'
  | 'received'
  | 'refunded'
  | 'rejected';

// ─── Filters ───────────────────────────────────────────────────

export interface ReturnListFilters {
  status?: ReturnStatus;
  order_id?: string;
  limit: number;
  offset: number;
}

export interface ReturnListResponse {
  items: ReturnDto[];
  limit: number;
  offset: number;
}

export const RETURNS_QUERY_KEYS = {
  all: ['returns'] as const,
  list: (shopId: string | null, filters: ReturnListFilters) =>
    ['returns', 'list', shopId, filters] as const,
  detail: (id: string) => ['returns', 'detail', id] as const,
};

// ─── List ──────────────────────────────────────────────────────

export function useReturns(shopId: string | null, filters: ReturnListFilters) {
  return useQuery({
    queryKey: RETURNS_QUERY_KEYS.list(shopId, filters),
    queryFn: async (): Promise<ReturnListResponse> => {
      const res = await api.get<ReturnListResponse>('/returns', {
        params: {
          shop_id: shopId ?? undefined,
          status: filters.status || undefined,
          order_id: filters.order_id || undefined,
          limit: filters.limit,
          offset: filters.offset,
        },
      });
      return res.data;
    },
    enabled: !!shopId,
    placeholderData: keepPreviousData,
  });
}

// ─── Detail ────────────────────────────────────────────────────

export function useReturn(id: string | undefined) {
  return useQuery({
    queryKey: RETURNS_QUERY_KEYS.detail(id ?? '__none__'),
    queryFn: async (): Promise<ReturnDto> => {
      const res = await api.get<{ return: ReturnDto }>(`/returns/${id}`);
      return res.data.return;
    },
    enabled: !!id,
  });
}

// ─── Mutations ─────────────────────────────────────────────────

export interface CreateReturnItemInput {
  orderItemId?: string | null;
  quantity?: number | null;
  restock?: boolean;
}

export interface CreateReturnInput {
  /** Bij top-level /api/returns: shopId of orderId verplicht. */
  shopId?: string;
  orderId?: string | null;
  reason?: string | null;
  refundAmount?: string;
  status?: ReturnStatus;
  items?: CreateReturnItemInput[];
}

export function useCreateReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateReturnInput): Promise<ReturnDto> => {
      const res = await api.post<{ return: ReturnDto }>('/returns', input);
      return res.data.return;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RETURNS_QUERY_KEYS.all });
    },
  });
}

export interface UpdateReturnInput {
  status?: ReturnStatus;
  reason?: string | null;
  refundAmount?: string;
}

export function useUpdateReturn(returnId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateReturnInput): Promise<ReturnDto> => {
      const res = await api.patch<{ return: ReturnDto }>(`/returns/${returnId}`, input);
      return res.data.return;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RETURNS_QUERY_KEYS.detail(returnId) });
      void qc.invalidateQueries({ queryKey: RETURNS_QUERY_KEYS.all });
    },
  });
}

// ─── Afgeleide helpers ─────────────────────────────────────────

/**
 * Een return is "teruggeboekt naar voorraad" als hij refunded is én minstens
 * één item met restock-flag heeft (backend boekt die dan automatisch terug).
 */
export function isRestocked(ret: Pick<ReturnDto, 'status' | 'items'>): boolean {
  if (ret.status !== 'refunded') return false;
  return (ret.items ?? []).some((it) => it.restock && (it.quantity ?? 0) > 0);
}

/** Totaal aantal teruggeboekte units (alleen zinvol op refunded returns). */
export function restockedUnits(items: ReturnItemDto[] | undefined): number {
  return (items ?? []).reduce(
    (sum, it) => (it.restock ? sum + (it.quantity ?? 0) : sum),
    0,
  );
}

/** Aantal items in een return (som van quantities, fallback op aantal regels). */
export function returnItemCount(items: ReturnItemDto[] | undefined): number {
  if (!items || items.length === 0) return 0;
  const summed = items.reduce((sum, it) => sum + (it.quantity ?? 0), 0);
  return summed > 0 ? summed : items.length;
}
