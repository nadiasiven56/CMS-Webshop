/**
 * React-Query hooks + DTO-types voor de audit-log (`/api/audit`, read-only).
 *
 * Bron-of-waarheid voor shapes = backend route-index
 * (`apps/api/src/routes/audit/index.ts` → `AuditEntryDto` + `toAuditDto`).
 *
 * De `before`/`after` zijn een COMPACTE samenvatting (top-level keys; geneste
 * objecten/arrays worden tot een type-marker samengevat) — niet de volle state.
 *
 * Conventie (zie components/channels/api.ts): hooks per feature, query-key-
 * factories met filters. Audit is read-only → geen mutations.
 */
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── DTO-types (mirror van backend index.ts) ───────────────────

export interface AuditEntryDto {
  id: string;
  actor: { type: string; id: string | null };
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

/** De lijst-response (de backend geeft GEEN total terug — alleen items). */
export interface AuditListResponse {
  items: AuditEntryDto[];
  limit: number;
  offset: number;
}

// ─── Filters ───────────────────────────────────────────────────

export interface AuditListFilters {
  entityType?: string;
  action?: string;
  actorId?: string;
  entityId?: string;
  /** ISO-datum (inclusief). */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const AUDIT_QUERY_KEYS = {
  all: ['audit'] as const,
  list: (filters: AuditListFilters) => ['audit', 'list', filters] as const,
  detail: (id: string) => ['audit', 'detail', id] as const,
};

// ─── List ──────────────────────────────────────────────────────

export function useAuditLog(filters: AuditListFilters = {}) {
  return useQuery({
    queryKey: AUDIT_QUERY_KEYS.list(filters),
    queryFn: async (): Promise<AuditListResponse> => {
      const res = await api.get<AuditListResponse>('/audit', {
        params: {
          entityType: filters.entityType || undefined,
          action: filters.action || undefined,
          actorId: filters.actorId || undefined,
          entityId: filters.entityId || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
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

export function useAuditEntry(id: string | undefined) {
  return useQuery({
    queryKey: AUDIT_QUERY_KEYS.detail(id ?? '__none__'),
    queryFn: async (): Promise<AuditEntryDto> => {
      const res = await api.get<{ entry: AuditEntryDto }>(`/audit/${id}`);
      return res.data.entry;
    },
    enabled: !!id,
  });
}

// ─── Presentational helpers ────────────────────────────────────

/**
 * Bekende entity-types uit de domein-flows. Vrije tekst blijft mogelijk
 * (server-side `eq`), maar dit vult de dropdown met de meest voorkomende.
 */
export const AUDIT_ENTITY_TYPES = [
  'order',
  'return',
  'product',
  'stock_item',
  'customer',
  'channel',
  'channel_product',
  'accounting_connection',
  'webhook',
  'shop',
  'purchase_order',
  'invoice',
] as const;

/** Bekende acties. */
export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'sync',
  'adjust',
  'login',
  'logout',
] as const;

const ACTION_BADGE: Record<string, string> = {
  create: 'badge-success',
  update: 'badge-info',
  delete: 'badge-danger',
  sync: 'badge-accent',
  adjust: 'badge-warning',
  login: 'badge-neutral',
  logout: 'badge-neutral',
};

export function actionBadgeClass(action: string): string {
  return ACTION_BADGE[action] ?? 'badge-neutral';
}

/** Leesbare actor-omschrijving ("Gebruiker", "Systeem", …). */
export function actorLabel(actor: { type: string; id: string | null }): string {
  if (actor.type === 'user') return 'Gebruiker';
  if (actor.type === 'system') return 'Systeem';
  if (actor.type === 'api') return 'API-token';
  return actor.type;
}
