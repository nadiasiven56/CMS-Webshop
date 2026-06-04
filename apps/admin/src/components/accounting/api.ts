/**
 * React-Query hooks + DTO-types voor het accounting-domein (boekhoud-koppeling).
 *
 * Bron-of-waarheid voor shapes = backend serializers
 * (`apps/api/src/routes/accounting/_serialize.ts`) + route-index
 * (`apps/api/src/routes/accounting/index.ts`) + schemas (`_schemas.ts`).
 *
 * KRITISCH (1-op-1 met de channels-conventie):
 *   - Koppelingen zijn NIET shop-scoped — globale boekhoud-connecties.
 *   - Credentials komen NOOIT raw terug: `credentials` is een presence-map
 *     (`{ accessToken: 'set' | null, ... }`) + `hasCredentials: boolean`.
 *   - Geld is in de sync-log/raw altijd een STRING (Money), nooit number.
 *   - List geeft detail-DTO's terug (inclusief `counts`).
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

export type AccountingProvider = 'moneybird' | 'exact' | 'eboekhouden';
export type AccountingStatus = 'disconnected' | 'connected' | 'error';

export interface AccountingConnectionDto {
  id: string;
  provider: string;
  name: string;
  status: string;
  /** Presence-map per credential-veld — NOOIT de raw waarde. */
  credentials: Record<string, 'set' | null>;
  /** True als er ueberhaupt versleutelde credentials opgeslagen zijn. */
  hasCredentials: boolean;
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingConnectionDetailDto extends AccountingConnectionDto {
  counts: {
    syncLog: number;
    synced: number;
    errors: number;
  };
}

export interface AccountingSyncLogDto {
  id: string;
  connectionId: string;
  entityType: string;
  entityId: string | null;
  externalId: string | null;
  status: string;
  message: string | null;
  raw: Record<string, unknown> | null;
  createdAt: string;
}

export interface ConnectionListResponse {
  items: AccountingConnectionDetailDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface SyncLogResponse {
  connectionId: string;
  items: AccountingSyncLogDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface TestConnectionResponse {
  ok: boolean;
  detail: string;
  connection: AccountingConnectionDetailDto;
}

export interface SyncResponse {
  scope: 'invoices' | 'orders';
  pushed: number;
  skipped: number;
  errors: string[];
}

// ─── Filters ───────────────────────────────────────────────────

export interface ConnectionListFilters {
  provider?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface SyncLogFilters {
  status?: 'pending' | 'synced' | 'error';
  entityType?: 'invoice' | 'order' | 'ledger_batch';
  limit?: number;
  offset?: number;
}

export const ACCOUNTING_QUERY_KEYS = {
  all: ['accounting'] as const,
  list: (filters: ConnectionListFilters) =>
    ['accounting', 'list', filters] as const,
  detail: (id: string) => ['accounting', 'detail', id] as const,
  syncLog: (id: string, filters: SyncLogFilters) =>
    ['accounting', 'sync-log', id, filters] as const,
};

// ─── List ──────────────────────────────────────────────────────

export function useConnections(filters: ConnectionListFilters = {}) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.list(filters),
    queryFn: async (): Promise<ConnectionListResponse> => {
      const res = await api.get<ConnectionListResponse>('/accounting/connections', {
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

// ─── Detail ────────────────────────────────────────────────────

export function useConnection(id: string | undefined) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.detail(id ?? '__none__'),
    queryFn: async (): Promise<AccountingConnectionDetailDto> => {
      const res = await api.get<{ connection: AccountingConnectionDetailDto }>(
        `/accounting/connections/${id}`,
      );
      return res.data.connection;
    },
    enabled: !!id,
  });
}

// ─── Sync-log ──────────────────────────────────────────────────

export function useSyncLog(id: string | undefined, filters: SyncLogFilters = {}) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.syncLog(id ?? '__none__', filters),
    queryFn: async (): Promise<SyncLogResponse> => {
      const res = await api.get<SyncLogResponse>(
        `/accounting/connections/${id}/sync-log`,
        {
          params: {
            status: filters.status || undefined,
            entityType: filters.entityType || undefined,
            limit: filters.limit,
            offset: filters.offset,
          },
        },
      );
      return res.data;
    },
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

// ─── Mutations ─────────────────────────────────────────────────

export interface CreateConnectionInput {
  provider: AccountingProvider;
  name: string;
  config?: Record<string, unknown>;
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreateConnectionInput,
    ): Promise<AccountingConnectionDetailDto> => {
      const res = await api.post<{ connection: AccountingConnectionDetailDto }>(
        '/accounting/connections',
        input,
      );
      return res.data.connection;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.all });
    },
  });
}

export interface UpdateConnectionInput {
  name?: string;
  config?: Record<string, unknown>;
  status?: AccountingStatus;
}

export function useUpdateConnection(connectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: UpdateConnectionInput,
    ): Promise<AccountingConnectionDetailDto> => {
      const res = await api.patch<{ connection: AccountingConnectionDetailDto }>(
        `/accounting/connections/${connectionId}`,
        input,
      );
      return res.data.connection;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.all });
    },
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      connectionId: string,
    ): Promise<{ ok: boolean; id: string }> => {
      const res = await api.delete<{ ok: boolean; id: string }>(
        `/accounting/connections/${connectionId}`,
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.all });
    },
  });
}

/**
 * PUT /:id/credentials — encrypt + store. Body-shape per provider:
 *   moneybird   : { accessToken }
 *   exact       : { accessToken, refreshToken, clientId, clientSecret }
 *   eboekhouden : { username, securityCode1, securityCode2 }
 */
export function useSetCredentials(connectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      credentials: Record<string, string>,
    ): Promise<AccountingConnectionDetailDto> => {
      const res = await api.put<{ connection: AccountingConnectionDetailDto }>(
        `/accounting/connections/${connectionId}/credentials`,
        credentials,
      );
      return res.data.connection;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.all });
    },
  });
}

export function useTestConnection(connectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<TestConnectionResponse> => {
      const res = await api.post<TestConnectionResponse>(
        `/accounting/connections/${connectionId}/test-connection`,
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.all });
    },
  });
}

export interface SyncInput {
  scope?: 'invoices' | 'orders';
  from?: string;
  to?: string;
}

export function useSyncConnection(connectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SyncInput = {}): Promise<SyncResponse> => {
      const res = await api.post<SyncResponse>(
        `/accounting/connections/${connectionId}/sync`,
        {
          scope: input.scope ?? 'invoices',
          from: input.from || undefined,
          to: input.to || undefined,
        },
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.all });
    },
  });
}

// ─── Provider-meta (presentational) ────────────────────────────
//
// `noUncheckedIndexedAccess` is aan → benader deze map ALTIJD via
// {@link providerMeta}, nooit met directe indexering.

export interface ProviderCredentialField {
  key: string;
  label: string;
  /** Render als password (masked) i.p.v. tekst. */
  secret?: boolean;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}

export interface ProviderConfigField {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
}

export interface ProviderMeta {
  label: string;
  kind: string;
  accent: string;
  letter: string;
  /** Korte beschrijving voor de card. */
  blurb: string;
  /** Credential-velden — exact de backend-schema-keys per provider. */
  credentialFields: ProviderCredentialField[];
  /** Config-velden (jsonb) — administrationId / division etc. */
  configFields: ProviderConfigField[];
  /** Onboarding-stappen: waar haal je de tokens vandaan. */
  steps: { title: string; items: string[] };
}

const PROVIDER_META: Record<AccountingProvider, ProviderMeta> = {
  moneybird: {
    label: 'Moneybird',
    kind: 'Boekhoudpakket',
    accent: '#0fa968',
    letter: 'M',
    blurb: 'Verkoopfacturen naar Moneybird via de officiele API.',
    credentialFields: [
      {
        key: 'accessToken',
        label: 'Access-token',
        secret: true,
        required: true,
        hint: 'Persoonlijk OAuth-token uit Moneybird.',
        placeholder: 'bijv. a1b2c3...',
      },
    ],
    configFields: [
      {
        key: 'administrationId',
        label: 'Administratie-ID',
        hint: 'Het administratie-id uit de Moneybird-URL.',
        placeholder: 'bijv. 123456789012345678',
      },
    ],
    steps: {
      title: 'Moneybird access-token',
      items: [
        'Log in op moneybird.com en open je administratie.',
        'Ga naar Instellingen → API-tokens (developer.moneybird.com).',
        "Klik 'Nieuw token', geef het een naam → kopieer het access-token.",
        'Het administratie-id staat in de URL: moneybird.com/<administratie-id>/.',
        "Plak beide hier en klik 'Test verbinding'.",
      ],
    },
  },
  exact: {
    label: 'Exact Online',
    kind: 'Boekhoudpakket',
    accent: '#e2001a',
    letter: 'E',
    blurb: 'Verkoopboekingen naar Exact Online via OAuth2.',
    credentialFields: [
      {
        key: 'accessToken',
        label: 'Access-token',
        secret: true,
        required: true,
        hint: 'OAuth2 access-token.',
      },
      {
        key: 'refreshToken',
        label: 'Refresh-token',
        secret: true,
        required: true,
        hint: 'OAuth2 refresh-token — om het access-token te vernieuwen.',
      },
      {
        key: 'clientId',
        label: 'Client-ID',
        required: true,
        hint: 'App-registratie client_id.',
      },
      {
        key: 'clientSecret',
        label: 'Client-secret',
        secret: true,
        required: true,
        hint: 'App-registratie client_secret.',
      },
    ],
    configFields: [
      {
        key: 'division',
        label: 'Divisie',
        hint: 'Exact division-nummer (administratie).',
        placeholder: 'bijv. 1234567',
      },
    ],
    steps: {
      title: 'Exact Online OAuth2',
      items: [
        'Ga naar apps.exactonline.com → Manage your apps.',
        "Registreer een app → noteer client_id en client_secret.",
        'Doorloop de OAuth2-authorize-flow → ontvang access- en refresh-token.',
        'Het divisie-nummer vind je via /api/v1/current/Me (CurrentDivision).',
        "Plak de velden hier en klik 'Test verbinding'.",
      ],
    },
  },
  eboekhouden: {
    label: 'e-Boekhouden',
    kind: 'Boekhoudpakket',
    accent: '#1a73c4',
    letter: 'B',
    blurb: 'Facturen naar e-Boekhouden via de REST-API.',
    credentialFields: [
      {
        key: 'username',
        label: 'Gebruikersnaam',
        required: true,
        hint: 'Je e-Boekhouden-gebruikersnaam.',
      },
      {
        key: 'securityCode1',
        label: 'Beveiligingscode 1',
        secret: true,
        required: true,
        hint: 'Vaste code uit je account.',
      },
      {
        key: 'securityCode2',
        label: 'Beveiligingscode 2',
        secret: true,
        required: true,
        hint: 'Per-administratie code.',
      },
    ],
    configFields: [],
    steps: {
      title: 'e-Boekhouden API-codes',
      items: [
        'Log in op secure.e-boekhouden.nl.',
        'Ga naar Beheer → Instellingen → API/SOAP.',
        'Activeer de API en noteer Beveiligingscode 1 en 2.',
        'Gebruikersnaam = je gewone login-naam.',
        "Plak de drie velden hier en klik 'Test verbinding'.",
      ],
    },
  },
};

const FALLBACK_META: ProviderMeta = {
  label: 'Onbekend',
  kind: 'Boekhoudpakket',
  accent: 'var(--theme-accent)',
  letter: '?',
  blurb: 'Onbekende provider.',
  credentialFields: [],
  configFields: [],
  steps: { title: '', items: [] },
};

/** Veilige accessor (respecteert noUncheckedIndexedAccess). */
export function providerMeta(provider: string): ProviderMeta {
  switch (provider) {
    case 'moneybird':
      return PROVIDER_META.moneybird;
    case 'exact':
      return PROVIDER_META.exact;
    case 'eboekhouden':
      return PROVIDER_META.eboekhouden;
    default:
      return { ...FALLBACK_META, label: provider, letter: (provider[0] ?? '?').toUpperCase() };
  }
}

/** De drie providers die de operator kan aanmaken. */
export const ACCOUNTING_PROVIDERS: AccountingProvider[] = [
  'moneybird',
  'exact',
  'eboekhouden',
];
