/**
 * React-Query hooks + DTO-types voor het shipping-domein (`/api/shipping`).
 *
 * Bron-of-waarheid voor shapes = backend serializers
 * (`apps/api/src/routes/shipping/_serialize.ts`) + schemas (`_schemas.ts`) +
 * route-index (`apps/api/src/routes/shipping/index.ts`).
 *
 * KRITISCH (spiegelt channels/api.ts):
 *   - Credentials komen NOOIT raw terug: `credentials` is een presence-map
 *     (`{ apiKey: 'set' | null, ... }`) + `hasCredentials: boolean`.
 *   - Carriers zijn NIET shop-scoped — globale verzend-connecties.
 *   - Bedragen (rates, indien ooit) blijven decimal-STRING (Money), nooit number.
 *   - List geeft detail-DTO's terug (inclusief `counts`).
 *
 * Conventie (zie components/channels/api.ts): hooks per feature, queryKeys met
 * filters, mutations invalideren de list-key.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── DTO-types (mirror van backend _serialize.ts) ──────────────

export type CarrierCode = 'sendcloud' | 'myparcel' | 'postnl' | 'dhl';
export type CarrierStatus = 'disconnected' | 'connected' | 'error';
export type ShipmentStatus =
  | 'pending'
  | 'label_created'
  | 'in_transit'
  | 'delivered'
  | 'error';

export interface CarrierDto {
  id: string;
  code: string;
  name: string;
  status: string;
  /** Presence-map per credential-veld — NOOIT de raw waarde. */
  credentials: Record<string, 'set' | null>;
  /** True als er ueberhaupt versleutelde credentials zijn opgeslagen. */
  hasCredentials: boolean;
  config: Record<string, unknown>;
  lastTestAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CarrierDetailDto extends CarrierDto {
  counts: {
    shipments: number;
  };
}

export interface ShipmentDto {
  id: string;
  orderId: string;
  carrierId: string | null;
  carrierCode: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  status: string;
  weightGrams: number | null;
  raw: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CarrierListResponse {
  items: CarrierDetailDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface ShipmentListResponse {
  items: ShipmentDto[];
  total: number;
  limit: number;
  offset: number;
}

/** PUT /credentials response: carrier + verify-resultaat. */
export interface SetCredentialsResponse {
  carrier: CarrierDetailDto;
  verify: { ok: boolean; detail: string };
}

/** POST /test-connection response. */
export interface TestCarrierResponse {
  ok: boolean;
  detail: string;
  carrier: CarrierDetailDto;
}

export interface TrackingEvent {
  status?: string;
  description?: string;
  timestamp?: string;
  location?: string;
  [key: string]: unknown;
}

/** GET /shipments/:id/tracking response. */
export interface ShipmentTrackingResponse {
  shipmentId: string;
  status: string;
  carrierStatus: string;
  events: TrackingEvent[];
}

// ─── Filters ───────────────────────────────────────────────────

export interface CarrierListFilters {
  status?: string;
  code?: string;
  limit?: number;
  offset?: number;
}

export interface ShipmentListFilters {
  order_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export const SHIPPING_QUERY_KEYS = {
  all: ['shipping'] as const,
  carriers: (filters: CarrierListFilters) =>
    ['shipping', 'carriers', filters] as const,
  carrier: (id: string) => ['shipping', 'carrier', id] as const,
  shipments: (filters: ShipmentListFilters) =>
    ['shipping', 'shipments', filters] as const,
};

// ─── Carriers: list / detail ───────────────────────────────────

export function useCarriers(filters: CarrierListFilters = {}) {
  return useQuery({
    queryKey: SHIPPING_QUERY_KEYS.carriers(filters),
    queryFn: async (): Promise<CarrierListResponse> => {
      const res = await api.get<CarrierListResponse>('/shipping/carriers', {
        params: {
          status: filters.status || undefined,
          code: filters.code || undefined,
          limit: filters.limit,
          offset: filters.offset,
        },
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

export function useCarrier(id: string | undefined) {
  return useQuery({
    queryKey: SHIPPING_QUERY_KEYS.carrier(id ?? '__none__'),
    queryFn: async (): Promise<CarrierDetailDto> => {
      const res = await api.get<{ carrier: CarrierDetailDto }>(
        `/shipping/carriers/${id}`,
      );
      return res.data.carrier;
    },
    enabled: !!id,
  });
}

// ─── Carriers: mutations ───────────────────────────────────────

export interface CreateCarrierInput {
  code: CarrierCode;
  name: string;
  config?: Record<string, unknown>;
}

export function useCreateCarrier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCarrierInput): Promise<CarrierDetailDto> => {
      const res = await api.post<{ carrier: CarrierDetailDto }>(
        '/shipping/carriers',
        input,
      );
      return res.data.carrier;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SHIPPING_QUERY_KEYS.all });
    },
  });
}

export interface UpdateCarrierInput {
  name?: string;
  config?: Record<string, unknown>;
  status?: CarrierStatus;
}

export function useUpdateCarrier(carrierId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateCarrierInput): Promise<CarrierDetailDto> => {
      const res = await api.patch<{ carrier: CarrierDetailDto }>(
        `/shipping/carriers/${carrierId}`,
        input,
      );
      return res.data.carrier;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SHIPPING_QUERY_KEYS.all });
    },
  });
}

export function useDeleteCarrier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      carrierId: string,
    ): Promise<{ ok: boolean; id: string }> => {
      const res = await api.delete<{ ok: boolean; id: string }>(
        `/shipping/carriers/${carrierId}`,
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SHIPPING_QUERY_KEYS.all });
    },
  });
}

/**
 * PUT /:id/credentials — encrypt + store + verify → status. Body-shape per
 * carrier-code:
 *   sendcloud : { publicKey, secretKey }
 *   myparcel  : { apiKey }
 *   postnl    : { apiKey, customerCode, customerNumber }
 *   dhl       : (geen credential-schema → 422)
 */
export function useSetCarrierCredentials(carrierId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      credentials: Record<string, string>,
    ): Promise<SetCredentialsResponse> => {
      const res = await api.put<SetCredentialsResponse>(
        `/shipping/carriers/${carrierId}/credentials`,
        credentials,
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SHIPPING_QUERY_KEYS.all });
    },
  });
}

export function useTestCarrier(carrierId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<TestCarrierResponse> => {
      const res = await api.post<TestCarrierResponse>(
        `/shipping/carriers/${carrierId}/test-connection`,
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SHIPPING_QUERY_KEYS.all });
    },
  });
}

// ─── Shipments ─────────────────────────────────────────────────

export function useShipments(filters: ShipmentListFilters = {}) {
  return useQuery({
    queryKey: SHIPPING_QUERY_KEYS.shipments(filters),
    queryFn: async (): Promise<ShipmentListResponse> => {
      const res = await api.get<ShipmentListResponse>('/shipping/shipments', {
        params: {
          order_id: filters.order_id || undefined,
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

/** GET /shipments/:id/tracking — on-demand (geen auto-poll). */
export function useShipmentTracking(shipmentId: string) {
  return useMutation({
    mutationFn: async (): Promise<ShipmentTrackingResponse> => {
      const res = await api.get<ShipmentTrackingResponse>(
        `/shipping/shipments/${shipmentId}/tracking`,
      );
      return res.data;
    },
  });
}

// ─── Credential-veld-metadata per carrier-code ─────────────────
//
// Beschrijft WELKE velden de PUT /credentials-body verwacht per code (mirror van
// CREDENTIALS_SCHEMA_BY_CODE in backend _schemas.ts), plus UI-hints en de
// "officiële route"-onboarding (waar haal je de keys).

export interface CredentialField {
  key: string;
  label: string;
  /** `password` rendert als masked input; `text` als gewoon veld. */
  type: 'text' | 'password';
  required: boolean;
  hint?: string;
  placeholder?: string;
}

export const CARRIER_CREDENTIAL_FIELDS: Record<CarrierCode, CredentialField[]> = {
  sendcloud: [
    {
      key: 'publicKey',
      label: 'Public key',
      type: 'text',
      required: true,
      hint: 'Sendcloud → Instellingen → Integraties → API.',
      placeholder: 'bijv. 1a2b3c4d…',
    },
    {
      key: 'secretKey',
      label: 'Secret key',
      type: 'password',
      required: true,
      hint: 'Wordt versleuteld opgeslagen.',
    },
  ],
  myparcel: [
    {
      key: 'apiKey',
      label: 'API-key',
      type: 'password',
      required: true,
      hint: 'MyParcel → Instellingen → Account → API-instellingen.',
    },
  ],
  postnl: [
    {
      key: 'apiKey',
      label: 'API-key',
      type: 'password',
      required: true,
      hint: 'PostNL Mijn Pakketten → API-key.',
    },
    {
      key: 'customerCode',
      label: 'Klantcode',
      type: 'text',
      required: true,
      hint: 'Bijv. DEVC.',
      placeholder: 'DEVC',
    },
    {
      key: 'customerNumber',
      label: 'Klantnummer',
      type: 'text',
      required: true,
      placeholder: '11223344',
    },
  ],
  dhl: [],
};

/** Onboarding-stappen per carrier (waar haal je de keys). */
export const CARRIER_ONBOARDING: Record<
  CarrierCode,
  { title: string; steps: string[] } | undefined
> = {
  sendcloud: {
    title: 'Sendcloud API',
    steps: [
      'Ga naar app.sendcloud.com → Instellingen → Integraties.',
      "Kies 'Sendcloud API' → activeer de integratie.",
      'Kopieer de Public key en Secret key.',
      'Plak ze hier en klik op Test verbinding.',
    ],
  },
  myparcel: {
    title: 'MyParcel API',
    steps: [
      'Ga naar backoffice.myparcel.nl → Instellingen → Account.',
      "Open 'API-instellingen' en genereer een API-key.",
      'Plak de API-key hier en klik op Test verbinding.',
    ],
  },
  postnl: {
    title: 'PostNL API',
    steps: [
      'Ga naar Mijn PostNL / Mijn Pakketten → API.',
      'Vraag een API-key aan voor de Shipping/Send & Track API.',
      'Noteer je klantcode (bv. DEVC) en klantnummer.',
      'Plak alles hier en klik op Test verbinding.',
    ],
  },
  dhl: undefined,
};

// ─── Presentational helpers ────────────────────────────────────

export const CARRIER_META: Record<
  string,
  { label: string; kind: string; accent: string; letter: string }
> = {
  sendcloud: { label: 'Sendcloud', kind: 'Multi-carrier', accent: '#1a73e8', letter: 'S' },
  myparcel: { label: 'MyParcel', kind: 'Multi-carrier', accent: '#ffd200', letter: 'M' },
  postnl: { label: 'PostNL', kind: 'Vervoerder', accent: '#ff6200', letter: 'P' },
  dhl: { label: 'DHL', kind: 'Vervoerder', accent: '#d40511', letter: 'D' },
};

export function carrierMeta(code: string) {
  return (
    CARRIER_META[code] ?? {
      label: code,
      kind: 'Vervoerder',
      accent: 'var(--theme-accent)',
      letter: (code[0] ?? '?').toUpperCase(),
    }
  );
}
