/**
 * React-Query hooks + DTO-types voor de admin/settings-module (`/api/admin/*`).
 *
 * Bron-of-waarheid voor shapes = backend serializers
 * (`apps/api/src/routes/admin/_serialize.ts`). Drie datasets:
 *   - users       → /api/admin/users
 *   - api-tokens  → /api/admin/api-tokens
 *   - webhooks    → /api/admin/webhooks
 *
 * Platform-beheer is NIET shop-scoped (geen `shop_id`-param) — users/tokens
 * gelden platform-breed, een webhook kan optioneel aan één shop gekoppeld zijn
 * (`shopId`). Mutaties invalideren de bijbehorende list-key. SECURITY: password-
 * hashes en token-hashes komen nooit mee; de raw token komt 1× terug in de
 * create-response (`token`) en wordt daarna nergens meer geserveerd.
 */
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── Generieke list-response ───────────────────────────────────

export interface AdminListResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ════════════════════════════════════════════════════════════════
// Users
// ════════════════════════════════════════════════════════════════

export interface UserDto {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

/** Rollen zoals gevalideerd door de backend (`_schemas.ts`). */
export const USER_ROLES = ['admin', 'manager', 'viewer', 'disabled'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserListFilters {
  search?: string;
  limit: number;
  offset: number;
}

export const USERS_QUERY_KEYS = {
  all: ['admin', 'users'] as const,
  list: (filters: UserListFilters) => ['admin', 'users', 'list', filters] as const,
};

export function useUserList(filters: UserListFilters) {
  return useQuery({
    queryKey: USERS_QUERY_KEYS.list(filters),
    queryFn: async (): Promise<AdminListResponse<UserDto>> => {
      const res = await api.get<AdminListResponse<UserDto>>('/admin/users', {
        params: {
          search: filters.search || undefined,
          limit: filters.limit,
          offset: filters.offset,
        },
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

export interface CreateUserInput {
  email: string;
  password: string;
  role?: UserRole;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput): Promise<UserDto> => {
      const res = await api.post<{ user: UserDto }>('/admin/users', input);
      return res.data.user;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USERS_QUERY_KEYS.all });
    },
  });
}

export interface UpdateUserInput {
  role?: UserRole;
  /** Convenience: true → role='disabled', false → role='admin'. */
  disabled?: boolean;
  password?: string;
}

export function useUpdateUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateUserInput): Promise<UserDto> => {
      const res = await api.patch<{ user: UserDto }>(`/admin/users/${id}`, input);
      return res.data.user;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USERS_QUERY_KEYS.all });
    },
  });
}

// ════════════════════════════════════════════════════════════════
// API-tokens
// ════════════════════════════════════════════════════════════════

export interface ApiTokenDto {
  id: string;
  label: string;
  scope: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ApiTokenListFilters {
  limit: number;
  offset: number;
}

export const TOKENS_QUERY_KEYS = {
  all: ['admin', 'api-tokens'] as const,
  list: (filters: ApiTokenListFilters) => ['admin', 'api-tokens', 'list', filters] as const,
};

export function useTokenList(filters: ApiTokenListFilters) {
  return useQuery({
    queryKey: TOKENS_QUERY_KEYS.list(filters),
    queryFn: async (): Promise<AdminListResponse<ApiTokenDto>> => {
      const res = await api.get<AdminListResponse<ApiTokenDto>>('/admin/api-tokens', {
        params: { limit: filters.limit, offset: filters.offset },
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

export interface CreateTokenInput {
  label: string;
  scope: string;
}

/** Create-response bevat de raw token 1×; deze wordt daarna nergens meer geserveerd. */
export interface CreateTokenResult {
  apiToken: ApiTokenDto;
  token: string;
}

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTokenInput): Promise<CreateTokenResult> => {
      const res = await api.post<CreateTokenResult>('/admin/api-tokens', input);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TOKENS_QUERY_KEYS.all });
    },
  });
}

export function useRevokeToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ ok: boolean; id: string }> => {
      const res = await api.post<{ ok: boolean; id: string }>(`/admin/api-tokens/${id}/revoke`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TOKENS_QUERY_KEYS.all });
    },
  });
}

// ════════════════════════════════════════════════════════════════
// Webhooks
// ════════════════════════════════════════════════════════════════

export interface WebhookDto {
  id: string;
  shopId: string | null;
  event: string;
  url: string;
  scope: string;
  /** Alleen of er een secret gezet is — nooit de waarde zelf. */
  hasSecret: boolean;
  active: boolean;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const WEBHOOK_SCOPES = ['order', 'channel', 'all'] as const;
export type WebhookScope = (typeof WEBHOOK_SCOPES)[number];

export interface WebhookListFilters {
  scope?: WebhookScope;
  active?: boolean;
  limit: number;
  offset: number;
}

export const WEBHOOKS_QUERY_KEYS = {
  all: ['admin', 'webhooks'] as const,
  list: (filters: WebhookListFilters) => ['admin', 'webhooks', 'list', filters] as const,
};

export function useWebhookList(filters: WebhookListFilters) {
  return useQuery({
    queryKey: WEBHOOKS_QUERY_KEYS.list(filters),
    queryFn: async (): Promise<AdminListResponse<WebhookDto>> => {
      const res = await api.get<AdminListResponse<WebhookDto>>('/admin/webhooks', {
        params: {
          scope: filters.scope || undefined,
          active: filters.active === undefined ? undefined : filters.active,
          limit: filters.limit,
          offset: filters.offset,
        },
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

export interface CreateWebhookInput {
  event: string;
  url: string;
  scope: WebhookScope;
  shopId?: string | null;
  secret?: string | null;
  active?: boolean;
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWebhookInput): Promise<WebhookDto> => {
      const res = await api.post<{ webhook: WebhookDto }>('/admin/webhooks', input);
      return res.data.webhook;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WEBHOOKS_QUERY_KEYS.all });
    },
  });
}

export interface UpdateWebhookInput {
  event?: string;
  url?: string;
  scope?: WebhookScope;
  shopId?: string | null;
  secret?: string | null;
  active?: boolean;
}

export function useUpdateWebhook(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateWebhookInput): Promise<WebhookDto> => {
      const res = await api.patch<{ webhook: WebhookDto }>(`/admin/webhooks/${id}`, input);
      return res.data.webhook;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WEBHOOKS_QUERY_KEYS.all });
    },
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ ok: boolean; id: string }> => {
      const res = await api.delete<{ ok: boolean; id: string }>(`/admin/webhooks/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WEBHOOKS_QUERY_KEYS.all });
    },
  });
}
