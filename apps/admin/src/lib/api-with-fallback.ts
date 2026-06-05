/**
 * api-with-fallback — wrappers rond axios die in DEMO_MODE eerst probeert
 * de echte backend en valt terug op mock-data wanneer er geen API draait.
 *
 * Strategie:
 *   - DEMO_MODE === true → meteen mock-data (backend wordt niet bevraagd)
 *   - DEMO_MODE === false → eerst api-call, fallback bij netwerkfout/5xx
 *
 * Hooks (lib/auth.ts, components/product/api.ts, etc) gebruiken deze
 * wrapper zodat de pages altijd iets te tonen hebben.
 */
import { api, asApiError } from './api';
import {
  DEMO_MODE,
  MOCK_PRODUCTS,
  MOCK_STOCK_ROWS,
  MOCK_MOVEMENTS,
  MOCK_KPIS,
  MOCK_USER,
  MOCK_SHOPS,
  getMockProduct,
  getMockStockItem,
  type MockProductWithRelations,
  type MockProductListItem,
  type MockStockItemRow,
  type MockStockItemDetail,
  type DashboardKpis,
} from './mock-data';

export { DEMO_MODE };

async function tryReal<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  if (DEMO_MODE) return { ok: false, reason: 'demo' };
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    const e = asApiError(err);
    // Val ALLEEN terug op mock-data bij een netwerk-/server-storing:
    //   status 0   → netwerkfout, CORS, timeout, geen verbinding
    //   status>=500 → server-fout
    // Bij een echte client-fout (4xx: 400/401/403/404/422/…) is mock-data
    // misleidend — geef de fout door zodat de UI 'm correct kan tonen
    // (bv. 401 → login-redirect, 404 → "niet gevonden").
    const isInfraFailure = e.status === 0 || e.status >= 500;
    if (!isInfraFailure) throw err;
    return { ok: false, reason: e.message };
  }
}

/* ─── Auth ───────────────────────────────────────────────────────────── */

export async function fetchAuthMe() {
  const real = await tryReal(async () => {
    const res = await api.get<{ user: typeof MOCK_USER }>('/auth/me');
    return res.data.user;
  });
  if (real.ok) return real.data;
  return { ...MOCK_USER };
}

/* ─── Shops (multi-store) ────────────────────────────────────────────── */

export async function listShops(): Promise<typeof MOCK_SHOPS> {
  const real = await tryReal(async () => {
    const res = await api.get<{ items: typeof MOCK_SHOPS }>('/shops', {
      params: { limit: 100 },
    });
    return res.data.items ?? MOCK_SHOPS;
  });
  if (real.ok) return real.data;
  return MOCK_SHOPS;
}

/* ─── Products ───────────────────────────────────────────────────────── */

interface ListProductsParams {
  limit: number;
  offset: number;
  status?: string;
  search?: string;
}

export async function listProducts(params: ListProductsParams) {
  const real = await tryReal(async () => {
    const search: Record<string, string> = {
      limit: String(params.limit),
      offset: String(params.offset),
    };
    if (params.status) search.status = params.status;
    if (params.search) search.search = params.search;
    const res = await api.get<{
      items: MockProductListItem[];
      total: number;
      limit: number;
      offset: number;
    }>('/products', { params: search });
    return res.data;
  });
  if (real.ok) return real.data;

  let items = [...MOCK_PRODUCTS];
  if (params.status) items = items.filter((p) => p.status === params.status);
  if (params.search) {
    const q = params.search.toLowerCase();
    items = items.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.vendor.toLowerCase().includes(q) ||
        p.productType.toLowerCase().includes(q),
    );
  }
  const total = items.length;
  const sliced = items.slice(params.offset, params.offset + params.limit);
  return { items: sliced, total, limit: params.limit, offset: params.offset };
}

export async function getProduct(id: string): Promise<MockProductWithRelations> {
  const real = await tryReal(async () => {
    const res = await api.get<{ product: MockProductWithRelations }>(`/products/${id}`);
    return res.data.product;
  });
  if (real.ok) return real.data;
  const p = getMockProduct(id);
  if (!p) throw new Error('Product niet gevonden');
  return p;
}

/* ─── Stock ──────────────────────────────────────────────────────────── */

interface StockListParams {
  page: number;
  pageSize: number;
  sort?: string;
  search?: string;
  lowStockOnly?: boolean;
}

export async function listStock(params: StockListParams) {
  const real = await tryReal(async () => {
    const p: Record<string, string> = {
      page: String(params.page),
      pageSize: String(params.pageSize),
    };
    if (params.sort) p.sort = params.sort;
    if (params.search) p.search = params.search;
    if (params.lowStockOnly) p.lowStockOnly = 'true';
    const res = await api.get<{
      items: MockStockItemRow[];
      page: number;
      pageSize: number;
      total: number;
    }>('/stock', { params: p });
    return res.data;
  });
  if (real.ok) return real.data;

  let items = [...MOCK_STOCK_ROWS];
  if (params.search) {
    const q = params.search.toLowerCase();
    items = items.filter(
      (r) => r.sku.toLowerCase().includes(q) || (r.productTitle ?? '').toLowerCase().includes(q),
    );
  }
  if (params.lowStockOnly) items = items.filter((r) => r.lowStock);
  const sortKey = params.sort ?? 'sku_asc';
  items.sort((a, b) => {
    const dir = sortKey.endsWith('_desc') ? -1 : 1;
    if (sortKey.startsWith('sku')) return a.sku.localeCompare(b.sku) * dir;
    if (sortKey.startsWith('available')) return (a.availableTotal - b.availableTotal) * dir;
    if (sortKey.startsWith('on_hand')) return (a.onHandTotal - b.onHandTotal) * dir;
    return 0;
  });

  const total = items.length;
  const start = (params.page - 1) * params.pageSize;
  const sliced = items.slice(start, start + params.pageSize);
  return { items: sliced, page: params.page, pageSize: params.pageSize, total };
}

export async function getStockItem(itemId: string): Promise<MockStockItemDetail> {
  const real = await tryReal(async () => {
    const res = await api.get<MockStockItemDetail>(`/stock/${itemId}`);
    return res.data;
  });
  if (real.ok) return real.data;
  const item = getMockStockItem(itemId);
  if (!item) throw new Error('Stock-item niet gevonden');
  return item;
}

/* ─── Movements ──────────────────────────────────────────────────────── */

interface MovementsListParams {
  page: number;
  pageSize: number;
  reason?: string;
  fromDate?: string;
  toDate?: string;
}

export async function listMovements(params: MovementsListParams) {
  const real = await tryReal(async () => {
    const p: Record<string, string> = {
      page: String(params.page),
      pageSize: String(params.pageSize),
    };
    if (params.reason) p.reason = params.reason;
    if (params.fromDate) p.from_date = params.fromDate;
    if (params.toDate) p.to_date = params.toDate;
    const res = await api.get<{
      items: typeof MOCK_MOVEMENTS;
      page: number;
      pageSize: number;
      total: number;
    }>('/movements', { params: p });
    return res.data;
  });
  if (real.ok) return real.data;

  let items = [...MOCK_MOVEMENTS];
  if (params.reason) items = items.filter((m) => m.reason === params.reason);
  if (params.fromDate) {
    const f = new Date(params.fromDate).getTime();
    items = items.filter((m) => new Date(m.createdAt).getTime() >= f);
  }
  if (params.toDate) {
    const t = new Date(params.toDate).getTime();
    items = items.filter((m) => new Date(m.createdAt).getTime() <= t);
  }
  const total = items.length;
  const start = (params.page - 1) * params.pageSize;
  const sliced = items.slice(start, start + params.pageSize);
  return { items: sliced, page: params.page, pageSize: params.pageSize, total };
}

/* ─── Dashboard ──────────────────────────────────────────────────────── */

export async function fetchDashboardKpis(): Promise<DashboardKpis> {
  const real = await tryReal(async () => {
    const res = await api.get<DashboardKpis>('/dashboard/kpis');
    return res.data;
  });
  if (real.ok) return real.data;
  return MOCK_KPIS;
}
