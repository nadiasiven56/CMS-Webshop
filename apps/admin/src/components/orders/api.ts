/**
 * React-Query hooks + DTO-types voor het orders-domein.
 *
 * Bron-of-waarheid voor shapes = backend serializers
 * (`apps/api/src/routes/orders/_serialize.ts`). Geld blijft string.
 * Alle endpoints zijn shop-scoped via `shop_id` (snake_case query-param,
 * zie orders/REGISTER.md). De queryKeys bevatten `activeShopId` zodat
 * shop-wissel automatisch herquerient.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── DTO-types (mirror van backend _serialize.ts) ──────────────

export interface OrderAddress {
  name?: string;
  company?: string;
  line1?: string;
  line2?: string;
  postcode?: string;
  city?: string;
  province?: string;
  country?: string;
  phone?: string;
}

export interface OrderCore {
  id: string;
  shopId: string;
  orderNumber: string;
  customerId: string | null;
  email: string | null;
  channel: string;
  status: string;
  financialStatus: string;
  fulfillmentStatus: string;
  currency: string;
  subtotal: string | null;
  discountTotal: string;
  shippingTotal: string;
  taxTotal: string;
  grandTotal: string | null;
  billingAddress: OrderAddress | null;
  shippingAddress: OrderAddress | null;
  note: string | null;
  placedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListItem extends OrderCore {
  itemCount: number;
  customerName: string | null;
}

export interface OrderItemDto {
  id: string;
  orderId: string;
  variantId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  unitPrice: string | null;
  taxRate: string;
  taxAmount: string;
  costPrice: string | null;
  lineTotal: string | null;
  margin: string | null;
  marginPct: number | null;
}

export interface OrderPaymentDto {
  id: string;
  orderId: string;
  provider: string | null;
  amount: string | null;
  status: string;
  reference: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface OrderFulfillmentDto {
  id: string;
  orderId: string;
  locationId: string | null;
  status: string;
  carrier: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  createdAt: string;
}

export interface ReturnItemDto {
  id: string;
  returnId: string;
  orderItemId: string | null;
  quantity: number | null;
  restock: boolean;
}

export interface ReturnDto {
  id: string;
  shopId: string;
  orderId: string | null;
  status: string;
  reason: string | null;
  refundAmount: string;
  createdAt: string;
  updatedAt: string;
  items?: ReturnItemDto[];
}

export interface OrderCustomerSnapshot {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  company: string | null;
}

export interface OrderDetail extends OrderCore {
  customer: OrderCustomerSnapshot | null;
  items: OrderItemDto[];
  payments: OrderPaymentDto[];
  fulfillments: OrderFulfillmentDto[];
  returns: ReturnDto[];
  margin: string | null;
  marginPct: number | null;
}

export interface OrderListResponse {
  items: OrderListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Filters ───────────────────────────────────────────────────

export interface OrderListFilters {
  status?: string;
  financial_status?: string;
  fulfillment_status?: string;
  channel?: string;
  search?: string;
  limit: number;
  offset: number;
}

export const ORDERS_QUERY_KEYS = {
  all: ['orders'] as const,
  list: (shopId: string | null, filters: OrderListFilters) =>
    ['orders', 'list', shopId, filters] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
};

// ─── List ──────────────────────────────────────────────────────

/**
 * Orders-lijst. Standaard shop-scoped (`shopId` = activeShopId).
 *
 * "Alle shops"-modus: geef `shopId = null` én `allShops = true` mee. Dan wordt
 * `shop_id` GEHEEL weggelaten uit de query (backend → orders over álle shops)
 * en blijft de query enabled. In single-shop-modus is `enabled` nog steeds
 * gegate op een geldige `shopId` (gedrag ongewijzigd t.o.v. eerder).
 */
export function useOrderList(
  shopId: string | null,
  filters: OrderListFilters,
  allShops = false,
) {
  return useQuery({
    queryKey: [...ORDERS_QUERY_KEYS.list(shopId, filters), allShops] as const,
    queryFn: async (): Promise<OrderListResponse> => {
      const res = await api.get<OrderListResponse>('/orders', {
        params: {
          // In all-shops-modus shop_id volledig weglaten → multi-shop resultaat.
          shop_id: allShops ? undefined : shopId ?? undefined,
          status: filters.status || undefined,
          financial_status: filters.financial_status || undefined,
          fulfillment_status: filters.fulfillment_status || undefined,
          channel: filters.channel || undefined,
          search: filters.search || undefined,
          limit: filters.limit,
          offset: filters.offset,
        },
      });
      return res.data;
    },
    // All-shops: altijd enabled. Single-shop: alleen met geldige shopId.
    enabled: allShops || !!shopId,
    placeholderData: keepPreviousData,
  });
}

// ─── Detail ────────────────────────────────────────────────────

export function useOrderDetail(id: string | undefined) {
  return useQuery({
    queryKey: ORDERS_QUERY_KEYS.detail(id ?? '__none__'),
    queryFn: async (): Promise<OrderDetail> => {
      const res = await api.get<{ order: OrderDetail }>(`/orders/${id}`);
      return res.data.order;
    },
    enabled: !!id,
  });
}

// ─── Mutations ─────────────────────────────────────────────────

export interface CreateOrderItemInput {
  sku?: string | null;
  title?: string | null;
  quantity: number;
  unitPrice: string;
  taxRate?: string;
  costPrice?: string | null;
}

export interface CreateOrderInput {
  shopId: string;
  customerId?: string | null;
  email?: string | null;
  channel?: string;
  currency?: string;
  items: CreateOrderItemInput[];
  shippingTotal?: string;
  discountTotal?: string;
  note?: string | null;
  placed?: boolean;
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOrderInput): Promise<OrderDetail> => {
      const res = await api.post<{ order: OrderDetail }>('/orders', input);
      return res.data.order;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS_QUERY_KEYS.all });
    },
  });
}

export function useUpdateOrderStatus(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { status: string; note?: string }): Promise<OrderCore> => {
      const res = await api.patch<{ order: OrderCore }>(`/orders/${orderId}/status`, input);
      return res.data.order;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS_QUERY_KEYS.detail(orderId) });
      void qc.invalidateQueries({ queryKey: ORDERS_QUERY_KEYS.all });
    },
  });
}

export interface CreateFulfillmentInput {
  locationId?: string | null;
  carrier?: string | null;
  trackingCode?: string | null;
  trackingUrl?: string | null;
  status?: 'pending' | 'shipped' | 'delivered';
  markShipped?: boolean;
}

export function useCreateFulfillment(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateFulfillmentInput): Promise<OrderFulfillmentDto> => {
      const res = await api.post<{ fulfillment: OrderFulfillmentDto }>(
        `/orders/${orderId}/fulfillments`,
        input,
      );
      return res.data.fulfillment;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS_QUERY_KEYS.detail(orderId) });
      void qc.invalidateQueries({ queryKey: ORDERS_QUERY_KEYS.all });
    },
  });
}

export interface CreatePaymentInput {
  provider?: 'mock' | 'ideal' | 'card' | 'bol';
  amount: string;
  status?: 'pending' | 'paid' | 'failed' | 'refunded';
  reference?: string | null;
  markPaid?: boolean;
}

export function useCreatePayment(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePaymentInput): Promise<OrderPaymentDto> => {
      const res = await api.post<{ payment: OrderPaymentDto }>(
        `/orders/${orderId}/payments`,
        input,
      );
      return res.data.payment;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS_QUERY_KEYS.detail(orderId) });
      void qc.invalidateQueries({ queryKey: ORDERS_QUERY_KEYS.all });
    },
  });
}

export interface CreateReturnItemInput {
  orderItemId?: string | null;
  quantity?: number | null;
  restock?: boolean;
}

export interface CreateReturnInput {
  reason?: string | null;
  refundAmount?: string;
  status?: 'requested' | 'approved' | 'received' | 'refunded' | 'rejected';
  items?: CreateReturnItemInput[];
}

export function useCreateReturn(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateReturnInput): Promise<ReturnDto> => {
      const res = await api.post<{ return: ReturnDto }>(`/orders/${orderId}/returns`, input);
      return res.data.return;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS_QUERY_KEYS.detail(orderId) });
      void qc.invalidateQueries({ queryKey: ORDERS_QUERY_KEYS.all });
    },
  });
}

// ─── Customers (voor create-order picker) ──────────────────────

export interface CustomerOptionDto {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
}

export function useCustomerOptions(shopId: string | null, search: string) {
  return useQuery({
    queryKey: ['orders', 'customer-options', shopId, search] as const,
    queryFn: async (): Promise<CustomerOptionDto[]> => {
      const res = await api.get<{ items: CustomerOptionDto[] }>('/customers', {
        params: { shopId: shopId ?? undefined, search: search || undefined, limit: 50 },
      });
      return res.data.items ?? [];
    },
    enabled: !!shopId,
    placeholderData: keepPreviousData,
  });
}
