/**
 * React-Query hooks + types voor de customers-module (echte, shop-scoped API).
 *
 * Eén centraal punt zodat de lijst-page (`/customers`) en de detail-page
 * (`/customers/:id`) dezelfde caching/invalidation delen. Praat met de echte
 * backend op `/api/customers` (zie `routes/customers/REGISTER.md`).
 *
 * Conventies (uit de backend-serializers):
 *   - camelCase DTO-velden
 *   - geld blijft string (`totalSpent`, `grandTotal`) → render via formatMoney
 *   - timestamps zijn ISO-strings
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

/* ─── DTO-types (spiegelen apps/api/.../customers/_serialize.ts) ────── */

export interface CustomerDto {
  id: string;
  shopId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  company: string | null;
  vatNumber: string | null;
  acceptsMarketing: boolean;
  tags: string[];
  notes: string | null;
  ordersCount: number;
  totalSpent: string;
  createdAt: string;
  updatedAt: string;
}

export type AddressType = 'billing' | 'shipping';

export interface CustomerAddressDto {
  id: string;
  customerId: string;
  type: string;
  isDefault: boolean;
  name: string | null;
  line1: string | null;
  line2: string | null;
  postcode: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  phone: string | null;
  createdAt: string;
}

export interface CustomerOrderDto {
  id: string;
  orderNumber: string;
  channel: string;
  status: string;
  financialStatus: string;
  fulfillmentStatus: string;
  currency: string;
  grandTotal: string | null;
  placedAt: string | null;
  createdAt: string;
}

/* ─── Request/response-shapes ───────────────────────────────────────── */

export interface CustomerListParams {
  shopId: string | null;
  search?: string;
  limit: number;
  offset: number;
}

export interface CustomerListResponse {
  items: CustomerDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface CustomerDetailResponse {
  customer: CustomerDto;
  addresses: CustomerAddressDto[];
}

export interface CustomerOrdersResponse {
  items: CustomerOrderDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface CustomerCreateInput {
  shopId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  company?: string | null;
  vatNumber?: string | null;
  acceptsMarketing?: boolean;
  tags?: string[];
  notes?: string | null;
}

export type CustomerUpdateInput = Partial<Omit<CustomerCreateInput, 'shopId'>>;

export interface AddressInput {
  type: AddressType;
  isDefault?: boolean;
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  postcode?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  phone?: string | null;
}

/* ─── Query-keys ────────────────────────────────────────────────────── */

export const CUSTOMER_KEYS = {
  all: ['customers'] as const,
  list: (params: CustomerListParams) => ['customers', 'list', params] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
  orders: (id: string, params: { limit: number; offset: number }) =>
    ['customers', 'orders', id, params] as const,
};

/* ─── Hooks: list ───────────────────────────────────────────────────── */

export function useCustomerList(params: CustomerListParams) {
  return useQuery({
    queryKey: CUSTOMER_KEYS.list(params),
    queryFn: async (): Promise<CustomerListResponse> => {
      const res = await api.get<CustomerListResponse>('/customers', {
        params: {
          shopId: params.shopId ?? undefined,
          search: params.search || undefined,
          limit: params.limit,
          offset: params.offset,
        },
      });
      return res.data;
    },
    enabled: !!params.shopId,
    placeholderData: keepPreviousData,
  });
}

/* ─── Hooks: detail ─────────────────────────────────────────────────── */

export function useCustomerDetail(id: string | undefined) {
  return useQuery({
    queryKey: CUSTOMER_KEYS.detail(id ?? '__none__'),
    queryFn: async (): Promise<CustomerDetailResponse> => {
      const res = await api.get<CustomerDetailResponse>(`/customers/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCustomerOrders(
  id: string | undefined,
  params: { limit: number; offset: number },
) {
  return useQuery({
    queryKey: CUSTOMER_KEYS.orders(id ?? '__none__', params),
    queryFn: async (): Promise<CustomerOrdersResponse> => {
      const res = await api.get<CustomerOrdersResponse>(`/customers/${id}/orders`, {
        params,
      });
      return res.data;
    },
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

/* ─── Mutations: customer CRUD ──────────────────────────────────────── */

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CustomerCreateInput): Promise<CustomerDto> => {
      const res = await api.post<{ customer: CustomerDto }>('/customers', input);
      return res.data.customer;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
  });
}

export function useUpdateCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CustomerUpdateInput): Promise<CustomerDto> => {
      const res = await api.patch<{ customer: CustomerDto }>(`/customers/${id}`, input);
      return res.data.customer;
    },
    onSuccess: (customer) => {
      qc.setQueryData<CustomerDetailResponse>(CUSTOMER_KEYS.detail(id), (prev) =>
        prev ? { ...prev, customer } : prev,
      );
      void qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/customers/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
  });
}

/* ─── Mutations: address CRUD ───────────────────────────────────────── */

export function useCreateAddress(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddressInput): Promise<CustomerAddressDto> => {
      const res = await api.post<{ address: CustomerAddressDto }>(
        `/customers/${customerId}/addresses`,
        input,
      );
      return res.data.address;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.detail(customerId) });
    },
  });
}

export function useUpdateAddress(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      addressId: string;
      patch: Partial<AddressInput>;
    }): Promise<CustomerAddressDto> => {
      const res = await api.patch<{ address: CustomerAddressDto }>(
        `/customers/${customerId}/addresses/${vars.addressId}`,
        vars.patch,
      );
      return res.data.address;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.detail(customerId) });
    },
  });
}

export function useDeleteAddress(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (addressId: string): Promise<void> => {
      await api.delete(`/customers/${customerId}/addresses/${addressId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.detail(customerId) });
    },
  });
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

/** Volledige naam uit voor/achternaam, met fallback op e-mail. */
export function customerName(c: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return full || c.email;
}

/** B2B = klant heeft een btw-nummer. */
export function isB2B(c: { vatNumber: string | null }): boolean {
  return !!c.vatNumber && c.vatNumber.trim().length > 0;
}
