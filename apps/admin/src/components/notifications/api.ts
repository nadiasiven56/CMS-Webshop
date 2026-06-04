/**
 * React-Query hooks + DTO-types voor de notifications/e-mail-module.
 *
 * Bron-of-waarheid voor shapes = backend serializers
 * (`apps/api/src/routes/notifications/_serialize.ts`) + route-index
 * (`apps/api/src/routes/notifications/index.ts`).
 *
 * KRITISCH (mirror van channels/api.ts):
 *   - Credentials komen NOOIT raw terug: `credentials` is een presence-map
 *     (`{ serverToken: 'set' | null, ... }`) + `hasCredentials: boolean`.
 *   - Exact één provider is `isActive` (single-active-provider via /activate).
 *   - Templates worden geseed (order_confirmation/order_shipped/order_refunded/
 *     return_received/welcome) — `key` is de stabiele identifier.
 *   - test-send geeft een status terug die ook 'skipped_no_provider' kan zijn
 *     (geen actieve verbonden provider) — dat is GEEN fout maar een hint.
 *
 * Conventie (zie components/channels/api.ts): hooks per feature, queryKeys met
 * filters, mutations invalideren de relevante key. Provider-meta-map met
 * noUncheckedIndexedAccess-veilige accessor.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── DTO-types (mirror van backend _serialize.ts) ──────────────

export type EmailProviderType = 'smtp' | 'postmark' | 'sendgrid' | 'mailgun';
export type EmailProviderStatus = 'disconnected' | 'connected' | 'error';

export interface ProviderDto {
  id: string;
  provider: string;
  name: string;
  status: string;
  /** Presence-map per credential-veld — NOOIT de raw waarde. */
  credentials: Record<string, 'set' | null>;
  /** True als er ueberhaupt versleutelde credentials opgeslagen zijn. */
  hasCredentials: boolean;
  config: Record<string, unknown>;
  isActive: boolean;
  lastTestAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDto {
  id: string;
  key: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  enabled: boolean;
  locale: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailLogDto {
  id: string;
  templateKey: string | null;
  toEmail: string;
  subject: string;
  status: string;
  provider: string | null;
  error: string | null;
  orderId: string | null;
  raw: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProviderListResponse {
  items: ProviderDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface TemplateListResponse {
  items: TemplateDto[];
  total: number;
}

export interface EmailLogResponse {
  items: EmailLogDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface TestConnectionResponse {
  ok: boolean;
  detail: string;
  provider: ProviderDto;
}

export interface TestSendResponse {
  status: 'sent' | 'failed' | 'skipped_no_provider' | string;
  logId: string;
  message: string;
}

// ─── Filters ───────────────────────────────────────────────────

export interface ProviderListFilters {
  provider?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface EmailLogFilters {
  to?: string;
  order_id?: string;
  limit?: number;
  offset?: number;
}

export const NOTIFICATIONS_QUERY_KEYS = {
  all: ['notifications'] as const,
  providers: (filters: ProviderListFilters) =>
    ['notifications', 'providers', filters] as const,
  provider: (id: string) => ['notifications', 'provider', id] as const,
  templates: ['notifications', 'templates'] as const,
  template: (key: string) => ['notifications', 'template', key] as const,
  log: (filters: EmailLogFilters) => ['notifications', 'log', filters] as const,
};

// ════════════════════════════════════════════════════════════
// Providers
// ════════════════════════════════════════════════════════════

export function useProviders(filters: ProviderListFilters = {}) {
  return useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEYS.providers(filters),
    queryFn: async (): Promise<ProviderListResponse> => {
      const res = await api.get<ProviderListResponse>('/notifications/providers', {
        params: {
          provider: filters.provider || undefined,
          status: filters.status || undefined,
          limit: filters.limit,
          offset: filters.offset,
        },
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

export function useProvider(id: string | undefined) {
  return useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEYS.provider(id ?? '__none__'),
    queryFn: async (): Promise<ProviderDto> => {
      const res = await api.get<{ provider: ProviderDto }>(
        `/notifications/providers/${id}`,
      );
      return res.data.provider;
    },
    enabled: !!id,
  });
}

export interface CreateProviderInput {
  provider: EmailProviderType;
  name: string;
  config?: Record<string, unknown>;
}

export function useCreateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProviderInput): Promise<ProviderDto> => {
      const res = await api.post<{ provider: ProviderDto }>(
        '/notifications/providers',
        input,
      );
      return res.data.provider;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEYS.all });
    },
  });
}

export interface UpdateProviderInput {
  name?: string;
  config?: Record<string, unknown>;
  status?: EmailProviderStatus;
}

export function useUpdateProvider(providerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateProviderInput): Promise<ProviderDto> => {
      const res = await api.patch<{ provider: ProviderDto }>(
        `/notifications/providers/${providerId}`,
        input,
      );
      return res.data.provider;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEYS.all });
    },
  });
}

export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (providerId: string): Promise<{ ok: boolean; id: string }> => {
      const res = await api.delete<{ ok: boolean; id: string }>(
        `/notifications/providers/${providerId}`,
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEYS.all });
    },
  });
}

/**
 * PUT /providers/:id/credentials — encrypt + store. Body-shape per provider:
 *   smtp     : { host, port, user, pass, secure }
 *   postmark : { serverToken }
 *   sendgrid : { apiKey }
 *   mailgun  : { apiKey }  (config.mailgunDomain via useUpdateProvider)
 */
export function useSetProviderCredentials(providerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      credentials: Record<string, string | number | boolean>,
    ): Promise<ProviderDto> => {
      const res = await api.put<{ provider: ProviderDto }>(
        `/notifications/providers/${providerId}/credentials`,
        credentials,
      );
      return res.data.provider;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEYS.all });
    },
  });
}

export function useTestProviderConnection(providerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<TestConnectionResponse> => {
      const res = await api.post<TestConnectionResponse>(
        `/notifications/providers/${providerId}/test-connection`,
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEYS.all });
    },
  });
}

/** POST /providers/:id/activate — single-active-provider (alle anderen uit). */
export function useActivateProvider(providerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ProviderDto> => {
      const res = await api.post<{ provider: ProviderDto }>(
        `/notifications/providers/${providerId}/activate`,
      );
      return res.data.provider;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEYS.all });
    },
  });
}

// ════════════════════════════════════════════════════════════
// Templates
// ════════════════════════════════════════════════════════════

export function useTemplates() {
  return useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEYS.templates,
    queryFn: async (): Promise<TemplateListResponse> => {
      const res = await api.get<TemplateListResponse>('/notifications/templates');
      return res.data;
    },
  });
}

export function useTemplate(key: string | undefined) {
  return useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEYS.template(key ?? '__none__'),
    queryFn: async (): Promise<TemplateDto> => {
      const res = await api.get<{ template: TemplateDto }>(
        `/notifications/templates/${key}`,
      );
      return res.data.template;
    },
    enabled: !!key,
  });
}

export interface PatchTemplateInput {
  name?: string;
  subject?: string;
  bodyHtml?: string;
  bodyText?: string | null;
  enabled?: boolean;
  locale?: string;
}

export function usePatchTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      key: string;
      patch: PatchTemplateInput;
    }): Promise<TemplateDto> => {
      const res = await api.patch<{ template: TemplateDto }>(
        `/notifications/templates/${vars.key}`,
        vars.patch,
      );
      return res.data.template;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEYS.all });
    },
  });
}

// ════════════════════════════════════════════════════════════
// Test-send + log
// ════════════════════════════════════════════════════════════

export interface TestSendInput {
  to: string;
  templateKey: string;
}

export function useTestSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TestSendInput): Promise<TestSendResponse> => {
      const res = await api.post<TestSendResponse>('/notifications/test-send', input);
      return res.data;
    },
    onSuccess: () => {
      // De log groeit door een test-send → invalideer de log-query.
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEYS.all });
    },
  });
}

export function useEmailLog(filters: EmailLogFilters = {}) {
  return useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEYS.log(filters),
    queryFn: async (): Promise<EmailLogResponse> => {
      const res = await api.get<EmailLogResponse>('/notifications/log', {
        params: {
          to: filters.to || undefined,
          order_id: filters.order_id || undefined,
          limit: filters.limit,
          offset: filters.offset,
        },
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

// ─── Presentational helpers ────────────────────────────────────

export interface ProviderMeta {
  label: string;
  kind: string;
  accent: string;
  letter: string;
  /** Korte uitleg waar je de keys vandaan haalt. */
  hint: string;
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  smtp: {
    label: 'SMTP',
    kind: 'Eigen mailserver',
    accent: '#64748b',
    letter: 'S',
    hint: 'Host, poort, gebruiker en wachtwoord van je eigen mailserver.',
  },
  postmark: {
    label: 'Postmark',
    kind: 'Transactioneel',
    accent: '#ffde00',
    letter: 'P',
    hint: 'Server-token uit je Postmark-server (API Tokens).',
  },
  sendgrid: {
    label: 'SendGrid',
    kind: 'Transactioneel',
    accent: '#1a82e2',
    letter: 'G',
    hint: 'API-key met "Mail Send"-rechten uit je SendGrid-account.',
  },
  mailgun: {
    label: 'Mailgun',
    kind: 'Transactioneel',
    accent: '#c02427',
    letter: 'M',
    hint: 'API-key + verzend-domein (mailgunDomain) uit je Mailgun-account.',
  },
};

/** noUncheckedIndexedAccess-veilige accessor (fallback voor onbekende provider). */
export function providerMeta(provider: string): ProviderMeta {
  return (
    PROVIDER_META[provider] ?? {
      label: provider,
      kind: 'Provider',
      accent: 'var(--theme-accent)',
      letter: (provider[0] ?? '?').toUpperCase(),
      hint: 'Vul de credentials van deze provider in.',
    }
  );
}

export interface TemplateMeta {
  label: string;
  description: string;
}

/** Mens-leesbare labels per geseede template-key. */
export const TEMPLATE_META: Record<string, TemplateMeta> = {
  order_confirmation: {
    label: 'Orderbevestiging',
    description: 'Verstuurd direct na het plaatsen van een order.',
  },
  order_shipped: {
    label: 'Order verzonden',
    description: 'Verstuurd zodra een order de deur uit is (met track & trace).',
  },
  order_refunded: {
    label: 'Order terugbetaald',
    description: 'Verstuurd bij een (gedeeltelijke) terugbetaling.',
  },
  return_received: {
    label: 'Retour ontvangen',
    description: 'Verstuurd zodra een geretourneerd pakket binnen is.',
  },
  welcome: {
    label: 'Welkom',
    description: 'Welkomstmail voor een nieuwe klant of account.',
  },
};

export function templateMeta(key: string): TemplateMeta {
  return (
    TEMPLATE_META[key] ?? {
      label: key,
      description: 'Transactionele e-mailtemplate.',
    }
  );
}
