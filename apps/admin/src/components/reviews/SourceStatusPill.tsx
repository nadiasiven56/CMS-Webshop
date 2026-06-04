/**
 * Status-pill voor de ECHTE review-source-statuswaarden uit de backend
 * (`apps/api/src/routes/reviews/_schemas.ts`): disconnected | connected | error.
 *
 * Spiegelt channels/ChannelStatusPill.tsx.
 */
const STATUS_MAP: Record<string, { label: string; klass: string }> = {
  connected: { label: 'Verbonden', klass: 'badge-success' },
  disconnected: { label: 'Niet verbonden', klass: 'badge-neutral' },
  error: { label: 'Fout', klass: 'badge-danger' },
};

export function SourceStatusPill({ status }: { status: string }) {
  const m = STATUS_MAP[status];
  if (!m) return <span className="badge badge-neutral">{status}</span>;
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}
