/**
 * Serializers — Drizzle-row → API-DTO voor de notifications/email-module.
 *
 * KRITISCH: credentials worden NOOIT raw teruggegeven. We tonen alleen een
 * presence-map via {@link maskCredentials} (`{ serverToken: 'set' | null, ... }`),
 * zodat de UI kan zien WELKE velden ingevuld zijn zonder de geheimen te lekken.
 *
 * Conventie (zie channels/_serialize.ts + accounting/_serialize.ts):
 *   - timestamps → ISO-string
 *   - jsonb (config) shape stabiel houden
 */
import type {
  EmailProviderConfig,
  EmailTemplate,
  EmailLog,
} from '../../db/schema/notifications.js';
import { decryptCredentials, maskCredentials } from '../../lib/channel-crypto.js';

export interface ProviderDto {
  id: string;
  provider: string;
  name: string;
  status: string;
  /** Presence-map per credential-veld — NOOIT de raw waarde. */
  credentials: Record<string, 'set' | null>;
  /** True als er ueberhaupt versleutelde credentials zijn opgeslagen. */
  hasCredentials: boolean;
  config: Record<string, unknown>;
  isActive: boolean;
  lastTestAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Decrypt-in-memory → mask. De decrypted waarden verlaten deze functie NOOIT;
 * we geven enkel de presence-map terug. Bij niet-ontsleutelbare/lege creds is de
 * map leeg ({}).
 */
function maskedCreds(config: EmailProviderConfig): Record<string, 'set' | null> {
  const decrypted = decryptCredentials(
    (config.credentials ?? null) as { enc: string } | null,
  );
  return maskCredentials(decrypted);
}

export function toProviderDto(p: EmailProviderConfig): ProviderDto {
  return {
    id: p.id,
    provider: p.provider,
    name: p.name,
    status: p.status,
    credentials: maskedCreds(p),
    hasCredentials: p.credentials != null,
    config: (p.config ?? {}) as Record<string, unknown>,
    isActive: p.isActive,
    lastTestAt: p.lastTestAt ? p.lastTestAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ─── email_templates ─────────────────────────────────────────

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

export function toTemplateDto(t: EmailTemplate): TemplateDto {
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    subject: t.subject,
    bodyHtml: t.bodyHtml,
    bodyText: t.bodyText,
    enabled: t.enabled,
    locale: t.locale,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// ─── email_log ───────────────────────────────────────────────

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

export function toEmailLogDto(l: EmailLog): EmailLogDto {
  return {
    id: l.id,
    templateKey: l.templateKey,
    toEmail: l.toEmail,
    subject: l.subject,
    status: l.status,
    provider: l.provider,
    error: l.error,
    orderId: l.orderId,
    raw: (l.raw ?? null) as Record<string, unknown> | null,
    createdAt: l.createdAt.toISOString(),
  };
}
