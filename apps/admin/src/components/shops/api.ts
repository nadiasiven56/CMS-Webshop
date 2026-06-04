/**
 * TanStack-Query hooks voor de shops-module.
 *
 * Praat met de echte backend (`/api/shops/*`) via de gedeelde axios-instance.
 * NB: deze module is NIET shop-scoped — ze beheert de shops zélf. Dus geen
 * `activeShopId` in queryKeys hier; de `:id` in de URL is de bron van waarheid.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { SHOPS_QUERY_KEY } from '@/lib/shop-context';
import type {
  CatalogProduct,
  ShopCreateInput,
  ShopDto,
  ShopListResponse,
  ShopProductDto,
  ShopProductsResponse,
  ShopProductUpsertInput,
  ShopUpdateInput,
} from './types';

export const SHOP_KEYS = {
  all: ['shops-admin'] as const,
  list: (params: ShopListParams) => ['shops-admin', 'list', params] as const,
  detail: (id: string) => ['shops-admin', 'detail', id] as const,
  products: (id: string, publishedOnly: boolean) =>
    ['shops-admin', 'products', id, publishedOnly] as const,
  catalog: ['shops-admin', 'catalog'] as const,
};

export interface ShopListParams {
  limit: number;
  offset: number;
  status?: string;
  search?: string;
}

export function useShopList(params: ShopListParams) {
  return useQuery({
    queryKey: SHOP_KEYS.list(params),
    queryFn: async (): Promise<ShopListResponse> => {
      const res = await api.get<ShopListResponse>('/shops', {
        params: {
          limit: params.limit,
          offset: params.offset,
          status: params.status || undefined,
          search: params.search || undefined,
        },
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

export function useShopDetail(id: string | undefined) {
  return useQuery({
    queryKey: SHOP_KEYS.detail(id ?? '__none__'),
    queryFn: async (): Promise<ShopDto> => {
      const res = await api.get<{ shop: ShopDto }>(`/shops/${id}`);
      return res.data.shop;
    },
    enabled: !!id,
  });
}

/** Invalideer ook de globale shop-switcher zodat nieuwe/gewijzigde shops daar verschijnen. */
function invalidateShops(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: SHOP_KEYS.all });
  void qc.invalidateQueries({ queryKey: SHOPS_QUERY_KEY });
}

export function useCreateShop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ShopCreateInput): Promise<ShopDto> => {
      const res = await api.post<{ shop: ShopDto }>('/shops', input);
      return res.data.shop;
    },
    onSuccess: () => invalidateShops(qc),
  });
}

export function useUpdateShop(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ShopUpdateInput): Promise<ShopDto> => {
      const res = await api.patch<{ shop: ShopDto }>(`/shops/${id}`, input);
      return res.data.shop;
    },
    onSuccess: (data) => {
      qc.setQueryData(SHOP_KEYS.detail(id), data);
      invalidateShops(qc);
    },
  });
}

export function useDeleteShop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/shops/${id}`);
    },
    onSuccess: () => invalidateShops(qc),
  });
}

// ─── Betalingen (Wave-H A4 — PSP-config per shop) ────────────
//
// De backend leest de PSP-config van een shop uit `shops.payment_provider`
// (text, bv. 'mollie' | null) + `shops.payment_credentials` (encrypted jsonb,
// shape `{ apiKey: 'test_…' | 'live_…' }`). Zie:
//   apps/api/src/domain/payments/index.ts (getPaymentProvider — de READ-kant)
//   apps/api/src/routes/storefront/checkout.ts (consument: null → mock-paid).
//
// De WRITE-kant volgt EXACT het contract dat die factory verwacht: een PATCH op
// de shop met `{ paymentProvider, paymentCredentials:{ apiKey } }`. Stuur de key
// alleen mee als de operator een nieuwe key invult (anders blijft de bestaande
// staan). `paymentProvider: null` + `paymentCredentials: null` koppelt los.
export interface ShopPaymentsInput {
  paymentProvider: 'mollie' | null;
  /** Alleen meesturen bij een nieuwe key; weglaten = bestaande key behouden. */
  paymentCredentials?: { apiKey: string } | null;
}

export function useUpdateShopPayments(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ShopPaymentsInput): Promise<ShopDto> => {
      const res = await api.patch<{ shop: ShopDto }>(`/shops/${id}`, input);
      return res.data.shop;
    },
    onSuccess: (data) => {
      qc.setQueryData(SHOP_KEYS.detail(id), data);
      invalidateShops(qc);
    },
  });
}

// ─── Publicatie-matrix ───────────────────────────────────────

export function useShopProducts(id: string | undefined, publishedOnly = false) {
  return useQuery({
    queryKey: SHOP_KEYS.products(id ?? '__none__', publishedOnly),
    queryFn: async (): Promise<ShopProductsResponse> => {
      const res = await api.get<ShopProductsResponse>(`/shops/${id}/products`, {
        params: publishedOnly ? { publishedOnly: 'true' } : undefined,
      });
      return res.data;
    },
    enabled: !!id,
  });
}

/**
 * Volledige catalogus (alle producten) — om niet-gepubliceerde producten te
 * kunnen tonen/toevoegen aan de matrix. Haalt tot 100 producten op
 * (backend limit-cap = 100; bij grotere catalogi later pagineren).
 */
export function useCatalogProducts() {
  return useQuery({
    queryKey: SHOP_KEYS.catalog,
    queryFn: async (): Promise<CatalogProduct[]> => {
      const res = await api.get<{ items: CatalogProduct[] }>('/products', {
        params: { limit: 100, offset: 0 },
      });
      return (res.data.items ?? []).map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        status: p.status,
      }));
    },
    staleTime: 30_000,
  });
}

export function useUpsertShopProduct(shopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      productId: string;
      patch: ShopProductUpsertInput;
    }): Promise<ShopProductDto> => {
      const res = await api.put<{ shopProduct: ShopProductDto }>(
        `/shops/${shopId}/products/${vars.productId}`,
        vars.patch,
      );
      return res.data.shopProduct;
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['shops-admin', 'products', shopId],
      });
    },
  });
}
