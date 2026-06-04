/**
 * React-Query hooks voor product-CRUD.
 *
 * Centraal punt zodat list-page + detail-page dezelfde caching delen.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { listProducts, getProduct, DEMO_MODE } from '@/lib/api-with-fallback';
import type {
  ProductWithRelations,
  ProductCreateInput,
  ProductUpdateInput,
  ProductListItem,
  VariantCreateInput,
  VariantUpdateInput,
  VariantDto,
} from './types';

export const PRODUCT_QUERY_KEYS = {
  all: ['products'] as const,
  list: (params: ListParams) => ['products', 'list', params] as const,
  detail: (id: string) => ['products', 'detail', id] as const,
};

export interface ListParams {
  limit: number;
  offset: number;
  status?: string;
  search?: string;
}

export interface ListResponse {
  items: ProductListItem[];
  total: number;
  limit: number;
  offset: number;
}

export function useProductList(params: ListParams) {
  return useQuery({
    queryKey: PRODUCT_QUERY_KEYS.list(params),
    queryFn: async (): Promise<ListResponse> => {
      // Gebruik fallback-helper: probeert echte API en valt terug op mock
      const data = await listProducts(params);
      return data as unknown as ListResponse;
    },
    placeholderData: keepPreviousData,
  });
}

export function useProductDetail(id: string | undefined) {
  return useQuery({
    queryKey: PRODUCT_QUERY_KEYS.detail(id ?? '__none__'),
    queryFn: async (): Promise<ProductWithRelations> => {
      const data = await getProduct(id!);
      return data as unknown as ProductWithRelations;
    },
    enabled: !!id,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProductCreateInput): Promise<ProductWithRelations> => {
      if (DEMO_MODE) {
        // Fake create — return een gemockt product
        return {
          id: `demo-new-${Date.now()}`,
          title: input.title,
          slug: input.slug ?? input.title.toLowerCase().replace(/\s+/g, '-'),
          status: input.status ?? 'draft',
          vendor: input.vendor ?? null,
          productType: input.productType ?? null,
          descriptionHtml: input.descriptionHtml ?? null,
          tags: input.tags ?? [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          variants: [],
          images: [],
          options: [],
        } as unknown as ProductWithRelations;
      }
      const res = await api.post<{ product: ProductWithRelations }>('/products', input);
      return res.data.product;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.all });
    },
  });
}

export function useUpdateProduct(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProductUpdateInput): Promise<ProductWithRelations> => {
      if (DEMO_MODE) {
        // No-op in demo: return current cached
        const cached = qc.getQueryData<ProductWithRelations>(PRODUCT_QUERY_KEYS.detail(id));
        return { ...(cached as ProductWithRelations), ...input } as ProductWithRelations;
      }
      const res = await api.patch<{ product: ProductWithRelations }>(`/products/${id}`, input);
      return res.data.product;
    },
    onSuccess: (data) => {
      qc.setQueryData(PRODUCT_QUERY_KEYS.detail(id), data);
      void qc.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.all });
    },
  });
}

export function useArchiveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      if (DEMO_MODE) return;
      await api.delete(`/products/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.all });
    },
  });
}

export function useAddVariant(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: VariantCreateInput): Promise<VariantDto> => {
      if (DEMO_MODE) {
        return {
          id: `demo-var-${Date.now()}`,
          productId,
          ...input,
          position: 999,
          optionValues: {},
        } as unknown as VariantDto;
      }
      const res = await api.post<{ variant: VariantDto }>(
        `/products/${productId}/variants`,
        input,
      );
      return res.data.variant;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.detail(productId) });
    },
  });
}

export function useUpdateVariant(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { variantId: string; patch: VariantUpdateInput }) => {
      if (DEMO_MODE) {
        return { id: vars.variantId, ...vars.patch } as unknown as VariantDto;
      }
      const res = await api.patch<{ variant: VariantDto }>(
        `/products/${productId}/variants/${vars.variantId}`,
        vars.patch,
      );
      return res.data.variant;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.detail(productId) });
    },
  });
}

export function useDeleteVariant(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (variantId: string): Promise<void> => {
      if (DEMO_MODE) return;
      await api.delete(`/products/${productId}/variants/${variantId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.detail(productId) });
    },
  });
}
