/**
 * React-Query hooks + DTO-types voor de inkoop-module (`/api/purchasing/*`).
 *
 * Centraal punt zodat suppliers- en purchase-orders-pages dezelfde caching
 * delen. Alle geld-velden komen als string (numeric(12,4)) binnen → render via
 * `formatMoney(Number(x))`.
 *
 * Purchasing is NIET shop-scoped (de backend-routes kennen geen shopId).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

/* ─── Supplier ──────────────────────────────────────────────── */

export interface SupplierAddress {
  line1?: string;
  line2?: string;
  postcode?: string;
  city?: string;
  province?: string;
  country?: string;
}

export interface Supplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: SupplierAddress | null;
  leadTimeDays: number;
  currency: string;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: SupplierAddress | null;
  leadTimeDays?: number;
  currency?: string;
  notes?: string | null;
  active?: boolean;
}

export interface SupplierListParams {
  limit: number;
  offset: number;
  search?: string;
  active?: boolean;
}

export interface SupplierListResponse {
  items: Supplier[];
  total: number;
  limit: number;
  offset: number;
}

/* ─── Purchase order ────────────────────────────────────────── */

export type PoStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';

export interface PurchaseOrderItem {
  id: string;
  poId: string;
  variantId: string | null;
  sku: string | null;
  quantity: number;
  unitCost: string | null;
  quantityReceived: number;
  quantityOutstanding: number;
  lineTotal: string | null;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  locationId: string | null;
  reference: string | null;
  status: PoStatus;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  expectedAt: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderListItem extends PurchaseOrder {
  itemCount: number;
}

export interface PurchaseOrderWithItems extends PurchaseOrder {
  items: PurchaseOrderItem[];
}

export interface PoItemInput {
  variantId?: string | null;
  sku?: string | null;
  quantity: number;
  unitCost?: string | null;
}

export interface PurchaseOrderCreateInput {
  supplierId: string;
  locationId?: string | null;
  reference?: string | null;
  currency?: string;
  expectedAt?: string | null;
  notes?: string | null;
  taxRate?: number;
  items: PoItemInput[];
}

export interface PurchaseOrderListParams {
  limit: number;
  offset: number;
  status?: PoStatus;
  supplierId?: string;
}

export interface PurchaseOrderListResponse {
  items: PurchaseOrderListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReceiveLine {
  itemId: string;
  quantity: number;
}

export interface ReceiveInput {
  locationId?: string | null;
  note?: string | null;
  lines: ReceiveLine[];
}

export interface ReceivedLineResult {
  itemId: string;
  variantId: string | null;
  quantity: number;
  stockMovementId: string | null;
  newOnHand: number | null;
}

export interface ReceiveResponse {
  ok: true;
  purchaseOrder: PurchaseOrderWithItems;
  received: ReceivedLineResult[];
}

/* ─── Query-keys ────────────────────────────────────────────── */

export const PURCHASING_KEYS = {
  suppliers: ['purchasing', 'suppliers'] as const,
  supplierList: (params: SupplierListParams) =>
    ['purchasing', 'suppliers', 'list', params] as const,
  pos: ['purchasing', 'po'] as const,
  poList: (params: PurchaseOrderListParams) =>
    ['purchasing', 'po', 'list', params] as const,
  poDetail: (id: string) => ['purchasing', 'po', 'detail', id] as const,
};

/* ─── Suppliers ─────────────────────────────────────────────── */

export function useSupplierList(params: SupplierListParams) {
  return useQuery({
    queryKey: PURCHASING_KEYS.supplierList(params),
    queryFn: async (): Promise<SupplierListResponse> => {
      const search: Record<string, string> = {
        limit: String(params.limit),
        offset: String(params.offset),
      };
      if (params.search) search.search = params.search;
      if (params.active !== undefined) search.active = String(params.active);
      const res = await api.get<SupplierListResponse>('/purchasing/suppliers', {
        params: search,
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SupplierInput): Promise<Supplier> => {
      const res = await api.post<{ supplier: Supplier }>('/purchasing/suppliers', input);
      return res.data.supplier;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCHASING_KEYS.suppliers });
    },
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; patch: SupplierInput }): Promise<Supplier> => {
      const res = await api.patch<{ supplier: Supplier }>(
        `/purchasing/suppliers/${vars.id}`,
        vars.patch,
      );
      return res.data.supplier;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCHASING_KEYS.suppliers });
    },
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; hard?: boolean }): Promise<void> => {
      await api.delete(`/purchasing/suppliers/${vars.id}`, {
        params: vars.hard ? { hard: 'true' } : undefined,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCHASING_KEYS.suppliers });
    },
  });
}

/* ─── Purchase orders ───────────────────────────────────────── */

export function usePurchaseOrderList(params: PurchaseOrderListParams) {
  return useQuery({
    queryKey: PURCHASING_KEYS.poList(params),
    queryFn: async (): Promise<PurchaseOrderListResponse> => {
      const search: Record<string, string> = {
        limit: String(params.limit),
        offset: String(params.offset),
      };
      if (params.status) search.status = params.status;
      if (params.supplierId) search.supplierId = params.supplierId;
      const res = await api.get<PurchaseOrderListResponse>('/purchasing/po', {
        params: search,
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

export function usePurchaseOrderDetail(id: string | undefined) {
  return useQuery({
    queryKey: PURCHASING_KEYS.poDetail(id ?? '__none__'),
    queryFn: async (): Promise<PurchaseOrderWithItems> => {
      const res = await api.get<{ purchaseOrder: PurchaseOrderWithItems }>(
        `/purchasing/po/${id}`,
      );
      return res.data.purchaseOrder;
    },
    enabled: !!id,
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PurchaseOrderCreateInput): Promise<PurchaseOrderWithItems> => {
      const res = await api.post<{ purchaseOrder: PurchaseOrderWithItems }>(
        '/purchasing/po',
        input,
      );
      return res.data.purchaseOrder;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCHASING_KEYS.pos });
    },
  });
}

export interface PoPatchInput {
  status?: PoStatus;
  locationId?: string | null;
  reference?: string | null;
  expectedAt?: string | null;
  notes?: string | null;
}

export function useUpdatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; patch: PoPatchInput }): Promise<PurchaseOrderWithItems> => {
      const res = await api.patch<{ purchaseOrder: PurchaseOrderWithItems }>(
        `/purchasing/po/${vars.id}`,
        vars.patch,
      );
      return res.data.purchaseOrder;
    },
    onSuccess: (data) => {
      qc.setQueryData(PURCHASING_KEYS.poDetail(data.id), data);
      void qc.invalidateQueries({ queryKey: PURCHASING_KEYS.pos });
    },
  });
}

export function useDeletePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/purchasing/po/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCHASING_KEYS.pos });
    },
  });
}

export function useReceivePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; input: ReceiveInput }): Promise<ReceiveResponse> => {
      const res = await api.post<ReceiveResponse>(
        `/purchasing/po/${vars.id}/receive`,
        vars.input,
      );
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(PURCHASING_KEYS.poDetail(data.purchaseOrder.id), data.purchaseOrder);
      void qc.invalidateQueries({ queryKey: PURCHASING_KEYS.pos });
      // voorraad is gemuteerd → stock/movements-caches verversen
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void qc.invalidateQueries({ queryKey: ['stock-detail'] });
      void qc.invalidateQueries({ queryKey: ['movements'] });
    },
  });
}

/* ─── Catalog-search voor PO-items (hergebruikt /stock-overview) ──
 *
 * Er is (nog) geen dedicated variant-search-endpoint; /stock levert per item
 * { itemId, sku, variantId, variantSku, productTitle } wat genoeg is om een
 * PO-regel met `variantId` + `sku` aan te maken. Items zonder variant worden
 * uitgefilterd (PO-receive boekt alleen stock voor variant-gekoppelde regels).
 */
export interface CatalogItem {
  itemId: string;
  sku: string;
  variantId: string | null;
  variantSku: string | null;
  productId: string | null;
  productTitle: string | null;
}

export function useCatalogSearch(search: string, enabled = true) {
  return useQuery({
    queryKey: ['purchasing', 'catalog-search', search],
    queryFn: async (): Promise<CatalogItem[]> => {
      const params: Record<string, string> = { page: '1', pageSize: '20' };
      if (search) params.search = search;
      const res = await api.get<{ items: CatalogItem[] }>('/stock', { params });
      return res.data.items ?? [];
    },
    enabled,
    placeholderData: keepPreviousData,
  });
}
