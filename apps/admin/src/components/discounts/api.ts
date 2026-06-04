/**
 * React-Query hooks + DTO-types voor de discounts/kortingen-module.
 *
 * Bron-of-waarheid voor shapes = backend serializers
 * (`apps/api/src/routes/discounts/_serialize.ts`) + route-index
 * (`apps/api/src/routes/discounts/index.ts`).
 *
 * KRITISCH (mirror van channels/api.ts):
 *   - Geld (`value`, `minSubtotal`, `amountApplied`, validate `subtotal`/`shipping`)
 *     is een decimal-STRING (Money, numeric(12,4)), NOOIT een number — in & uit.
 *   - `status` is door de backend afgeleid (scheduled/active/expired/exhausted/
 *     disabled) — de UI interpreteert de window/limiet niet zelf.
 *   - POST /validate is een admin-preview die NIETS muteert; `{valid:false}` is
 *     géén fout (HTTP 200) maar een preview-resultaat met reason+message.
 *
 * Conventie: hooks per feature, queryKeys met filters, mutations invalideren de
 * relevante key. Type-meta-map met noUncheckedIndexedAccess-veilige accessor.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── DTO-types (mirror van backend _serialize.ts) ──────────────

export type DiscountType = 'percentage' | 'fixed' | 'free_shipping';
export type DiscountStatus =
  | 'scheduled'
  | 'active'
  | 'expired'
  | 'exhausted'
  | 'disabled';

export interface DiscountDto {
  id: string;
  code: string;
  shopId: string | null;
  type: string;
  value: string;
  currency: string;
  minSubtotal: string | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  maxPerCustomer: number | null;
  timesRedeemed: number;
  active: boolean;
  description: string | null;
  status: DiscountStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionDto {
  id: string;
  discountId: string;
  orderId: string | null;
  customerEmail: string | null;
  amountApplied: string;
  createdAt: string;
}

export interface DiscountListResponse {
  items: DiscountDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface RedemptionListResponse {
  discountId: string;
  items: RedemptionDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Resultaat van POST /validate — discriminated op `valid`. */
export type ValidateResult =
  | {
      valid: true;
      discountId: string;
      code: string;
      type: string;
      discountCents: number;
      /** Money-string van de berekende korting. */
      discount: string;
      freeShipping: boolean;
      currency: string;
    }
  | {
      valid: false;
      reason: string;
      message: string;
    };

// ─── Filters ───────────────────────────────────────────────────

export interface DiscountListFilters {
  shop_id?: string;
  active?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export const DISCOUNTS_QUERY_KEYS = {
  all: ['discounts'] as const,
  list: (filters: DiscountListFilters) => ['discounts', 'list', filters] as const,
  detail: (id: string) => ['discounts', 'detail', id] as const,
  redemptions: (id: string) => ['discounts', 'redemptions', id] as const,
};

// ─── List ──────────────────────────────────────────────────────

export function useDiscounts(filters: DiscountListFilters = {}) {
  return useQuery({
    queryKey: DISCOUNTS_QUERY_KEYS.list(filters),
    queryFn: async (): Promise<DiscountListResponse> => {
      const res = await api.get<DiscountListResponse>('/discounts', {
        params: {
          shop_id: filters.shop_id || undefined,
          active: filters.active === undefined ? undefined : String(filters.active),
          q: filters.q || undefined,
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

export function useDiscount(id: string | undefined) {
  return useQuery({
    queryKey: DISCOUNTS_QUERY_KEYS.detail(id ?? '__none__'),
    queryFn: async (): Promise<DiscountDto> => {
      const res = await api.get<{ discount: DiscountDto }>(`/discounts/${id}`);
      return res.data.discount;
    },
    enabled: !!id,
  });
}

// ─── Redemptions ───────────────────────────────────────────────

export function useDiscountRedemptions(id: string | undefined) {
  return useQuery({
    queryKey: DISCOUNTS_QUERY_KEYS.redemptions(id ?? '__none__'),
    queryFn: async (): Promise<RedemptionListResponse> => {
      const res = await api.get<RedemptionListResponse>(`/discounts/${id}/redemptions`);
      return res.data;
    },
    enabled: !!id,
  });
}

// ─── Mutations ─────────────────────────────────────────────────
//
// Velden mirroren DiscountCreateSchema. Geld als STRING. Datums als ISO-string
// (of null). free_shipping negeert `value` (backend default '0').

export interface CreateDiscountInput {
  code: string;
  type: DiscountType;
  value?: string;
  shopId?: string | null;
  currency?: string;
  minSubtotal?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  maxRedemptions?: number | null;
  maxPerCustomer?: number | null;
  active?: boolean;
  description?: string | null;
}

export function useCreateDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDiscountInput): Promise<DiscountDto> => {
      const res = await api.post<{ discount: DiscountDto }>('/discounts', input);
      return res.data.discount;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DISCOUNTS_QUERY_KEYS.all });
    },
  });
}

export type UpdateDiscountInput = Partial<CreateDiscountInput>;

export function useUpdateDiscount(discountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateDiscountInput): Promise<DiscountDto> => {
      const res = await api.patch<{ discount: DiscountDto }>(
        `/discounts/${discountId}`,
        input,
      );
      return res.data.discount;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DISCOUNTS_QUERY_KEYS.all });
    },
  });
}

export function useDeleteDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (discountId: string): Promise<{ ok: boolean; id: string }> => {
      const res = await api.delete<{ ok: boolean; id: string }>(`/discounts/${discountId}`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DISCOUNTS_QUERY_KEYS.all });
    },
  });
}

export interface ValidateDiscountInput {
  code: string;
  shop_id?: string | null;
  subtotal: string;
  currency?: string;
  customer_email?: string;
  shipping?: string;
}

/** POST /validate — admin-preview. Muteert niets; returnt het preview-resultaat. */
export function useValidateDiscount() {
  return useMutation({
    mutationFn: async (input: ValidateDiscountInput): Promise<ValidateResult> => {
      const res = await api.post<ValidateResult>('/discounts/validate', input);
      return res.data;
    },
  });
}

// ─── Presentational helpers ────────────────────────────────────

export interface DiscountTypeMeta {
  label: string;
  /** Korte uitleg van het type. */
  hint: string;
  /** Of `value` een percentage is (anders een geldbedrag), of niet van toepassing. */
  valueKind: 'percent' | 'amount' | 'none';
}

export const DISCOUNT_TYPE_META: Record<string, DiscountTypeMeta> = {
  percentage: {
    label: 'Percentage',
    hint: 'Een percentage korting op het subtotaal (bv. 10 = 10%).',
    valueKind: 'percent',
  },
  fixed: {
    label: 'Vast bedrag',
    hint: 'Een vast bedrag korting op het subtotaal.',
    valueKind: 'amount',
  },
  free_shipping: {
    label: 'Gratis verzending',
    hint: 'Maakt de verzendkosten gratis. Geen waarde nodig.',
    valueKind: 'none',
  },
};

export function discountTypeMeta(type: string): DiscountTypeMeta {
  return (
    DISCOUNT_TYPE_META[type] ?? {
      label: type,
      hint: 'Kortingstype.',
      valueKind: 'amount',
    }
  );
}

export interface DiscountStatusMeta {
  label: string;
  klass: string;
}

/** Status → pill-label + badge-klasse. */
export const DISCOUNT_STATUS_META: Record<string, DiscountStatusMeta> = {
  active: { label: 'Actief', klass: 'badge-success' },
  scheduled: { label: 'Gepland', klass: 'badge-info' },
  expired: { label: 'Verlopen', klass: 'badge-neutral' },
  exhausted: { label: 'Op', klass: 'badge-warning' },
  disabled: { label: 'Uit', klass: 'badge-neutral' },
};

export function discountStatusMeta(status: string): DiscountStatusMeta {
  return DISCOUNT_STATUS_META[status] ?? { label: status, klass: 'badge-neutral' };
}
