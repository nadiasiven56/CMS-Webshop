/**
 * Status-pill voor de ECHTE channel-statuswaarden uit de backend
 * (`apps/api/src/routes/channels/_schemas.ts`): disconnected | connected | error.
 *
 * (De orders-Pills.ChannelStatusPill kent alleen connected/warning/error/paused
 * en mist 'disconnected', daarom een eigen pill voor dit domein.)
 */
const STATUS_MAP: Record<string, { label: string; klass: string }> = {
  connected: { label: 'Verbonden', klass: 'badge-success' },
  disconnected: { label: 'Niet verbonden', klass: 'badge-neutral' },
  error: { label: 'Fout', klass: 'badge-danger' },
};

export function ChannelStatusPill({ status }: { status: string }) {
  const m = STATUS_MAP[status];
  if (!m) return <span className="badge badge-neutral">{status}</span>;
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}
