/**
 * Status-pill voor de ECHTE provider-statuswaarden uit de backend
 * (`apps/api/src/routes/notifications/_schemas.ts`):
 * disconnected | connected | error.
 *
 * Mirror van channels/ChannelStatusPill.tsx — eigen pill omdat de orders-pills
 * 'disconnected' niet kennen.
 */
const STATUS_MAP: Record<string, { label: string; klass: string }> = {
  connected: { label: 'Verbonden', klass: 'badge-success' },
  disconnected: { label: 'Niet verbonden', klass: 'badge-neutral' },
  error: { label: 'Fout', klass: 'badge-danger' },
};

export function ProviderStatusPill({ status }: { status: string }) {
  const m = STATUS_MAP[status];
  if (!m) return <span className="badge badge-neutral">{status}</span>;
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}

/**
 * Status-pill voor een email_log-rij. De backend schrijft o.a.
 * sent | failed | skipped_no_provider (en mogelijk provider-specifieke statussen).
 */
const LOG_STATUS_MAP: Record<string, { label: string; klass: string }> = {
  sent: { label: 'Verzonden', klass: 'badge-success' },
  failed: { label: 'Mislukt', klass: 'badge-danger' },
  skipped_no_provider: { label: 'Overgeslagen', klass: 'badge-warning' },
  queued: { label: 'In wachtrij', klass: 'badge-info' },
};

export function EmailLogStatusPill({ status }: { status: string }) {
  const m = LOG_STATUS_MAP[status];
  if (!m) return <span className="badge badge-neutral">{status}</span>;
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}
