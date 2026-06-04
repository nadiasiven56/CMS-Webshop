/**
 * React-Query hooks + DTO-types voor het reviews-domein (`/api/reviews`).
 *
 * Bron-of-waarheid voor shapes = backend serializers
 * (`apps/api/src/routes/reviews/_serialize.ts`) + schemas (`_schemas.ts`) +
 * route-index (`apps/api/src/routes/reviews/index.ts`).
 *
 * KRITISCH (spiegelt channels/api.ts):
 *   - Credentials komen NOOIT raw terug: `credentials` is een presence-map
 *     (`{ apiHash: 'set' | null, ... }`) + `hasCredentials: boolean`.
 *   - `ratingAverage` blijft een STRING (numeric(3,2)) of null — nooit silently
 *     floaten in de DTO. De /summary-endpoint geeft daarentegen een number.
 *   - Sources zijn NIET shop-scoped — globale review-provider-connecties.
 *
 * Conventie: hooks per feature, queryKeys met filters, mutations invalideren de
 * relevante keys.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── DTO-types (mirror van backend _serialize.ts) ──────────────

export type ReviewProvider = 'kiyoh' | 'trustpilot' | 'google';
export type ReviewSourceStatus = 'disconnected' | 'connected' | 'error';

export interface ReviewSourceDto {
  id: string;
  provider: string;
  name: string;
  status: string;
  /** Presence-map per credential-veld — NOOIT de raw waarde. */
  credentials: Record<string, 'set' | null>;
  /** True als er ueberhaupt versleutelde credentials zijn opgeslagen. */
  hasCredentials: boolean;
  config: Record<string, unknown>;
  /** numeric(3,2) → string of null (nooit silently floaten). */
  ratingAverage: string | null;
  ratingCount: number;
  lastFetchAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewDto {
  id: string;
  sourceId: string;
  externalId: string | null;
  provider: string | null;
  rating: number | null;
  title: string | null;
  body: string | null;
  authorName: string | null;
  productId: string | null;
  orderId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceListResponse {
  items: ReviewSourceDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReviewListResponse {
  sourceId: string;
  items: ReviewDto[];
  total: number;
  limit: number;
  offset: number;
}

/** POST /test-connection response. */
export interface TestSourceResponse {
  ok: boolean;
  detail: string;
  source: ReviewSourceDto;
}

/** POST /fetch response: upsert + samenvatting. */
export interface FetchReviewsResponse {
  upserted: number;
  ratingAverage: string | null;
  ratingCount: number;
  errors: string[];
  source: ReviewSourceDto;
}

/** GET /summary response — distribution = aantal per ster (1..5). */
export interface ReviewSummaryResponse {
  sourceId: string | null;
  count: number;
  rated: number;
  average: number | null;
  distribution: Record<string, number>;
}

// ─── Filters ───────────────────────────────────────────────────

export interface SourceListFilters {
  provider?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export const REVIEWS_QUERY_KEYS = {
  all: ['reviews'] as const,
  sources: (filters: SourceListFilters) => ['reviews', 'sources', filters] as const,
  source: (id: string) => ['reviews', 'source', id] as const,
  sourceReviews: (id: string, limit: number) =>
    ['reviews', 'source-reviews', id, limit] as const,
  summary: (sourceId: string | undefined) => ['reviews', 'summary', sourceId ?? 'all'] as const,
};

// ─── Sources: list / detail ────────────────────────────────────

export function useReviewSources(filters: SourceListFilters = {}) {
  return useQuery({
    queryKey: REVIEWS_QUERY_KEYS.sources(filters),
    queryFn: async (): Promise<SourceListResponse> => {
      const res = await api.get<SourceListResponse>('/reviews/sources', {
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

export function useReviewSource(id: string | undefined) {
  return useQuery({
    queryKey: REVIEWS_QUERY_KEYS.source(id ?? '__none__'),
    queryFn: async (): Promise<ReviewSourceDto> => {
      const res = await api.get<{ source: ReviewSourceDto }>(`/reviews/sources/${id}`);
      return res.data.source;
    },
    enabled: !!id,
  });
}

// ─── Sources: mutations ────────────────────────────────────────

export interface CreateSourceInput {
  provider: ReviewProvider;
  name: string;
  config?: Record<string, unknown>;
}

export function useCreateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSourceInput): Promise<ReviewSourceDto> => {
      const res = await api.post<{ source: ReviewSourceDto }>('/reviews/sources', input);
      return res.data.source;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REVIEWS_QUERY_KEYS.all });
    },
  });
}

export interface UpdateSourceInput {
  name?: string;
  config?: Record<string, unknown>;
  status?: ReviewSourceStatus;
}

export function useUpdateSource(sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSourceInput): Promise<ReviewSourceDto> => {
      const res = await api.patch<{ source: ReviewSourceDto }>(
        `/reviews/sources/${sourceId}`,
        input,
      );
      return res.data.source;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REVIEWS_QUERY_KEYS.all });
    },
  });
}

export function useDeleteSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sourceId: string): Promise<{ ok: boolean; id: string }> => {
      const res = await api.delete<{ ok: boolean; id: string }>(`/reviews/sources/${sourceId}`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REVIEWS_QUERY_KEYS.all });
    },
  });
}

/**
 * PUT /:id/credentials — encrypt + store. Body-shape per provider:
 *   kiyoh      : { apiHash }
 *   trustpilot : { apiKey, apiSecret }
 *   google     : { accessToken }
 */
export function useSetSourceCredentials(sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      credentials: Record<string, string>,
    ): Promise<ReviewSourceDto> => {
      const res = await api.put<{ source: ReviewSourceDto }>(
        `/reviews/sources/${sourceId}/credentials`,
        credentials,
      );
      return res.data.source;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REVIEWS_QUERY_KEYS.all });
    },
  });
}

export function useTestSource(sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<TestSourceResponse> => {
      const res = await api.post<TestSourceResponse>(
        `/reviews/sources/${sourceId}/test-connection`,
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REVIEWS_QUERY_KEYS.all });
    },
  });
}

/** POST /:id/fetch — haal reviews op bij de provider en upsert ze. */
export function useFetchReviews(sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<FetchReviewsResponse> => {
      const res = await api.post<FetchReviewsResponse>(`/reviews/sources/${sourceId}/fetch`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REVIEWS_QUERY_KEYS.all });
    },
  });
}

// ─── Stored reviews + summary ──────────────────────────────────

export function useSourceReviews(sourceId: string | undefined, limit = 20) {
  return useQuery({
    queryKey: REVIEWS_QUERY_KEYS.sourceReviews(sourceId ?? '__none__', limit),
    queryFn: async (): Promise<ReviewListResponse> => {
      const res = await api.get<ReviewListResponse>(`/reviews/sources/${sourceId}/reviews`, {
        params: { limit },
      });
      return res.data;
    },
    enabled: !!sourceId,
    placeholderData: keepPreviousData,
  });
}

export function useReviewSummary(sourceId?: string) {
  return useQuery({
    queryKey: REVIEWS_QUERY_KEYS.summary(sourceId),
    queryFn: async (): Promise<ReviewSummaryResponse> => {
      const res = await api.get<ReviewSummaryResponse>('/reviews/summary', {
        params: { source_id: sourceId || undefined },
      });
      return res.data;
    },
  });
}

// ─── Credential-veld + config-veld metadata per provider ───────
//
// Mirror van CREDENTIALS_SCHEMA_BY_PROVIDER (creds) en de configSchema-keys
// (config) in backend _schemas.ts.

export interface ProviderField {
  key: string;
  label: string;
  type: 'text' | 'password';
  required: boolean;
  hint?: string;
  placeholder?: string;
}

/** Credential-velden (gaan naar PUT /credentials, versleuteld). */
export const PROVIDER_CREDENTIAL_FIELDS: Record<ReviewProvider, ProviderField[]> = {
  kiyoh: [
    {
      key: 'apiHash',
      label: 'API-hash',
      type: 'password',
      required: true,
      hint: 'Kiyoh → Connect / API → API-hash.',
    },
  ],
  trustpilot: [
    {
      key: 'apiKey',
      label: 'API-key',
      type: 'text',
      required: true,
      hint: 'Trustpilot Business → Integrations → API.',
    },
    {
      key: 'apiSecret',
      label: 'API-secret',
      type: 'password',
      required: true,
      hint: 'Wordt versleuteld opgeslagen.',
    },
  ],
  google: [
    {
      key: 'accessToken',
      label: 'Access-token (OAuth)',
      type: 'password',
      required: true,
      hint: 'OAuth2-token met scope business.manage (Google Business Profile API).',
    },
  ],
};

/** Config-velden (gaan naar create/PATCH config — NIET versleuteld). */
export const PROVIDER_CONFIG_FIELDS: Record<ReviewProvider, ProviderField[]> = {
  kiyoh: [
    {
      key: 'locationId',
      label: 'Location-ID',
      type: 'text',
      required: false,
      hint: 'Kiyoh location/connector-id.',
    },
  ],
  trustpilot: [
    {
      key: 'businessUnitId',
      label: 'Business-unit-ID',
      type: 'text',
      required: false,
      hint: 'Trustpilot business unit-id.',
    },
  ],
  google: [
    {
      key: 'accountId',
      label: 'Account-ID',
      type: 'text',
      required: false,
      hint: 'Google Business Profile account-id.',
    },
    {
      key: 'locationId',
      label: 'Location-ID',
      type: 'text',
      required: false,
      hint: 'Google Business Profile location-id.',
    },
  ],
};

/** Onboarding-stappen per provider (waar haal je de keys). */
export const PROVIDER_ONBOARDING: Record<
  ReviewProvider,
  { title: string; steps: string[] }
> = {
  kiyoh: {
    title: 'Kiyoh API',
    steps: [
      'Log in op je Kiyoh-dashboard.',
      'Ga naar Connect / API-instellingen.',
      'Kopieer je API-hash en (optioneel) de location-id.',
      'Plak alles hier en klik op Test verbinding.',
    ],
  },
  trustpilot: {
    title: 'Trustpilot Business API',
    steps: [
      'Ga naar businessapp.b2b.trustpilot.com → Integrations → API.',
      'Maak een API-application aan → noteer API-key en API-secret.',
      'Zoek je Business unit-id (in de API-docs of via /find-business-unit).',
      'Plak alles hier en klik op Test verbinding.',
    ],
  },
  google: {
    title: 'Google Business Profile API',
    steps: [
      'Activeer de Business Profile API in Google Cloud Console.',
      'Doorloop de OAuth2-flow met scope business.manage.',
      'Kopieer het access-token + je account-id en location-id.',
      'Plak alles hier en klik op Test verbinding.',
    ],
  },
};

// ─── Presentational helpers ────────────────────────────────────

export const PROVIDER_META: Record<
  string,
  { label: string; kind: string; accent: string; letter: string }
> = {
  kiyoh: { label: 'Kiyoh', kind: 'Reviews', accent: '#00a651', letter: 'K' },
  trustpilot: { label: 'Trustpilot', kind: 'Reviews', accent: '#00b67a', letter: 'T' },
  google: { label: 'Google Reviews', kind: 'Reviews', accent: '#4285f4', letter: 'G' },
};

export function providerMeta(provider: string) {
  return (
    PROVIDER_META[provider] ?? {
      label: provider,
      kind: 'Reviews',
      accent: 'var(--theme-accent)',
      letter: (provider[0] ?? '?').toUpperCase(),
    }
  );
}
