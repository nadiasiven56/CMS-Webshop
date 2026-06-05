/**
 * Fetch-wrapper voor de publieke storefront-API.
 *
 * - stuurt automatisch `X-Shop-Slug: <active-slug>` mee (shop-scoping);
 * - praat via de vite-proxy met `/api/storefront/v1/*` (geen CORS in dev);
 * - geeft JSON terug, gooit een getypeerde ApiError bij niet-2xx;
 * - guard tegen niet-JSON (bv. een HTML-404 van een verkeerde route).
 */
import { getActiveShopSlug } from './shop-context';
import type {
  Shop,
  ProductListResponse,
  ProductDetail,
  PageResponse,
  Menu,
  BlogListResponse,
  BlogPost,
  Cart,
  OrderResult,
  SortOption,
  CheckoutBody,
  OrderStatusResponse,
} from './types';

const BASE = '/api/storefront/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(`${code} (HTTP ${status})`);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = opts;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Shop-Slug': getActiveShopSlug(),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', String(err));
  }

  // Guard: een verkeerd pad kan HTML teruggeven (geen JSON) → nette error.
  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  if (isJson) {
    payload = await res.json().catch(() => null);
  } else {
    // body wegslurpen om geen open stream te laten hangen
    await res.text().catch(() => '');
  }

  if (!res.ok) {
    const code =
      (isJson && (payload as { error?: string })?.error) || `http_${res.status}`;
    const details = isJson ? (payload as { details?: unknown })?.details : undefined;
    throw new ApiError(res.status, code, details);
  }

  if (!isJson) {
    throw new ApiError(res.status, 'non_json_response');
  }

  return payload as T;
}

// ─── Endpoints ───────────────────────────────────────────────

export const api = {
  getShop: (signal?: AbortSignal) =>
    request<{ shop: Shop }>('/shop', { signal }).then((r) => r.shop),

  listProducts: (
    params: {
      limit?: number;
      offset?: number;
      search?: string;
      tag?: string;
      sort?: SortOption;
    } = {},
    signal?: AbortSignal,
  ) => {
    const q = new URLSearchParams();
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    if (params.search) q.set('search', params.search);
    if (params.tag) q.set('tag', params.tag);
    if (params.sort) q.set('sort', params.sort);
    const qs = q.toString();
    return request<ProductListResponse>(`/products${qs ? `?${qs}` : ''}`, { signal });
  },

  getProduct: (slug: string, signal?: AbortSignal) =>
    request<{ product: ProductDetail }>(`/products/${encodeURIComponent(slug)}`, {
      signal,
    }).then((r) => r.product),

  getPage: (slug: string, signal?: AbortSignal) =>
    request<PageResponse>(`/pages/${encodeURIComponent(slug)}`, { signal }),

  listMenus: (signal?: AbortSignal) =>
    request<{ menus: Menu[] }>('/menus', { signal }).then((r) => r.menus),

  listBlog: (
    params: { limit?: number; offset?: number; tag?: string } = {},
    signal?: AbortSignal,
  ) => {
    const q = new URLSearchParams();
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    if (params.tag) q.set('tag', params.tag);
    const qs = q.toString();
    return request<BlogListResponse>(`/blog${qs ? `?${qs}` : ''}`, { signal });
  },

  getBlogPost: (slug: string, signal?: AbortSignal) =>
    request<{ post: BlogPost }>(`/blog/${encodeURIComponent(slug)}`, {
      signal,
    }).then((r) => r.post),

  // ── Cart ──
  createCart: () =>
    request<{ cart: Cart }>('/cart', { method: 'POST', body: {} }).then(
      (r) => r.cart,
    ),

  getCart: (token: string, signal?: AbortSignal) =>
    request<{ cart: Cart }>(`/cart/${encodeURIComponent(token)}`, { signal }).then(
      (r) => r.cart,
    ),

  addCartItem: (token: string, variantId: string, quantity = 1) =>
    request<{ cart: Cart }>(`/cart/${encodeURIComponent(token)}/items`, {
      method: 'POST',
      body: { variantId, quantity },
    }).then((r) => r.cart),

  updateCartItem: (token: string, itemId: string, quantity: number) =>
    request<{ cart: Cart }>(
      `/cart/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}`,
      { method: 'PATCH', body: { quantity } },
    ).then((r) => r.cart),

  removeCartItem: (token: string, itemId: string) =>
    request<{ cart: Cart }>(
      `/cart/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' },
    ).then((r) => r.cart),

  checkout: (token: string, body: CheckoutBody) =>
    request<OrderResult>(`/cart/${encodeURIComponent(token)}/checkout`, {
      method: 'POST',
      body,
    }),

  getOrderStatus: (orderNumber: string, signal?: AbortSignal) =>
    request<OrderStatusResponse>(
      `/orders/${encodeURIComponent(orderNumber)}/status`,
      { signal },
    ),
};
