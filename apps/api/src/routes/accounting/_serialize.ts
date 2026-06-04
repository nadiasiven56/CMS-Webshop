/**
 * Serializers — Drizzle-row → API-DTO voor de accounting-module.
 *
 * KRITISCH: credentials worden NOOIT raw teruggegeven. We tonen alleen een
 * presence-map via {@link maskCredentials} (`{ accessToken: 'set' | null, ... }`),
 * zodat de UI kan zien WELKE velden ingevuld zijn zonder de geheimen te lekken.
 *
 * Conventie (zie channels/_serialize.ts):
 *   - timestamps → ISO-string
 *   - jsonb (config) shape stabiel houden
 */
import type {
  AccountingConnection,
  AccountingSyncLog,
} from '../../db/schema/accounting.js';
import { decryptCredentials, maskCredentials } from '../../lib/channel-crypto.js';

export interface AccountingConnectionDto {
  id: string;
  provider: string;
  name: string;
  status: string;
  /** Presence-map per credential-veld — NOOIT de raw waarde. */
  credentials: Record<string, 'set' | null>;
  /** True als er ueberhaupt versleutelde credentials zijn opgeslagen. */
  hasCredentials: boolean;
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Detail-DTO = list-DTO + sync-log counts. */
export interface AccountingConnectionDetailDto extends AccountingConnectionDto {
  counts: {
    syncLog: number;
    synced: number;
    errors: number;
  };
}

/**
 * Decrypt-in-memory → mask. De decrypted waarden verlaten deze functie NOOIT;
 * we geven enkel de presence-map terug. Bij niet-ontsleutelbare/lege creds is de
 * map leeg ({}).
 */
function maskedCreds(conn: AccountingConnection): Record<string, 'set' | null> {
  const decrypted = decryptCredentials(
    (conn.credentials ?? null) as { enc: string } | null,
  );
  return maskCredentials(decrypted);
}

export function toConnectionDto(
  c: AccountingConnection,
): AccountingConnectionDto {
  return {
    id: c.id,
    provider: c.provider,
    name: c.name,
    status: c.status,
    credentials: maskedCreds(c),
    hasCredentials: c.credentials != null,
    config: (c.config ?? {}) as Record<string, unknown>,
    lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toConnectionDetailDto(
  c: AccountingConnection,
  counts: { syncLog: number; synced: number; errors: number },
): AccountingConnectionDetailDto {
  return {
    ...toConnectionDto(c),
    counts,
  };
}

// ─── accounting_sync_log ─────────────────────────────────────

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

export function toSyncLogDto(l: AccountingSyncLog): AccountingSyncLogDto {
  return {
    id: l.id,
    connectionId: l.connectionId,
    entityType: l.entityType,
    entityId: l.entityId,
    externalId: l.externalId,
    status: l.status,
    message: l.message,
    raw: (l.raw ?? null) as Record<string, unknown> | null,
    createdAt: l.createdAt.toISOString(),
  };
}
