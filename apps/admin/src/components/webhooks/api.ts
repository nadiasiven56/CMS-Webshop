/**
 * React-Query hooks + DTO-types voor de webhook-DELIVERY-monitor (`/api/webhooks`).
 *
 * NB: dit is de delivery-/dispatch-laag — de webhook-CRUD zelf woont op de
 * bestaande settings.webhooks-pagina (`/api/admin/webhooks`). Hier ALLEEN:
 *   - de append-only delivery-log,
 *   - een handmatige test-fire,
 *   - de event-catalogus voor de dropdowns.
 *
 * Bron-of-waarheid voor shapes = backend serializers
 * (`apps/api/src/routes/webhooks/_serialize.ts`) + route-index (`index.ts`) +
 * schemas (`_schemas.ts`).
 *
 * Conventie (zie components/channels/api.ts): hooks per feature, query-key-
 * factories met filters, mutations invalideren de all-key.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── DTO-types (mirror van backend _serialize.ts) ──────────────

export interface WebhookDeliveryListDto {
  id: string;
  webhookId: string | null;
  event: string;
  url: string;
  success: boolean;
  responseStatus: number | null;
  attempt: number;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface WebhookDeliveryDetailDto extends WebhookDeliveryListDto {
  payload: Record<string, unknown> | null;
  requestHeaders: Record<string, string> | null;
  responseBody: string | null;
}

export interface DeliveryListResponse {
  items: WebhookDeliveryListDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface WebhookEventsResponse {
  events: string[];
}

export interface TestFireResponse {
  ok: boolean;
  event: string;
  delivery: {
    id: string | null;
    webhookId: string | null;
    url: string;
    success: boolean;
    responseStatus: number | null;
    durationMs: number | null;
    errorMessage: string | null;
  };
}

// ─── Filters ───────────────────────────────────────────────────

export interface DeliveryListFilters {
  webhookId?: string;
  event?: string;
  /** undefined = alle, true = geslaagd, false = mislukt. */
  success?: boolean;
  limit?: number;
  offset?: number;
}

export const WEBHOOKS_QUERY_KEYS = {
  all: ['webhook-deliveries'] as const,
  list: (filters: DeliveryListFilters) =>
    ['webhook-deliveries', 'list', filters] as const,
  detail: (id: string) => ['webhook-deliveries', 'detail', id] as const,
  events: ['webhook-events'] as const,
};

// ─── Deliveries (list) ─────────────────────────────────────────

export function useDeliveries(filters: DeliveryListFilters = {}) {
  return useQuery({
    queryKey: WEBHOOKS_QUERY_KEYS.list(filters),
    queryFn: async (): Promise<DeliveryListResponse> => {
      const res = await api.get<DeliveryListResponse>('/webhooks/deliveries', {
        params: {
          webhook_id: filters.webhookId || undefined,
          event: filters.event || undefined,
          success: filters.success === undefined ? undefined : String(filters.success),
          limit: filters.limit,
          offset: filters.offset,
        },
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

// ─── Delivery (detail) ─────────────────────────────────────────

export function useDelivery(id: string | undefined) {
  return useQuery({
    queryKey: WEBHOOKS_QUERY_KEYS.detail(id ?? '__none__'),
    queryFn: async (): Promise<WebhookDeliveryDetailDto> => {
      const res = await api.get<{ delivery: WebhookDeliveryDetailDto }>(
        `/webhooks/deliveries/${id}`,
      );
      return res.data.delivery;
    },
    enabled: !!id,
  });
}

// ─── Event-catalogus (dropdowns) ───────────────────────────────

export function useWebhookEvents() {
  return useQuery({
    queryKey: WEBHOOKS_QUERY_KEYS.events,
    queryFn: async (): Promise<string[]> => {
      const res = await api.get<WebhookEventsResponse>('/webhooks/events');
      return res.data.events;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Test-fire ─────────────────────────────────────────────────

/**
 * POST /test-fire — twee vormen:
 *   - { webhookId, event? }        → laad een bestaande webhook en vuur.
 *   - { event, url, secret? }      → ad-hoc target zonder webhook-row.
 */
export interface TestFireInput {
  webhookId?: string;
  event?: string;
  url?: string;
  secret?: string;
}

export function useTestFire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TestFireInput): Promise<TestFireResponse> => {
      const body: Record<string, unknown> = {};
      if (input.webhookId) body.webhookId = input.webhookId;
      if (input.event) body.event = input.event;
      if (input.url) body.url = input.url;
      if (input.secret) body.secret = input.secret;
      const res = await api.post<TestFireResponse>('/webhooks/test-fire', body);
      return res.data;
    },
    onSuccess: () => {
      // De test-fire schrijft een delivery-log-rij → log verversen.
      void qc.invalidateQueries({ queryKey: WEBHOOKS_QUERY_KEYS.all });
    },
  });
}
