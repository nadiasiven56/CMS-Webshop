/**
 * Status-pill voor de boekhoud-koppeling-statuswaarden uit de backend
 * (`apps/api/src/routes/accounting/_schemas.ts`): disconnected | connected | error.
 *
 * Mirror van channels/ChannelStatusPill — eigen pill omdat de orders-Pills
 * andere statuswaarden kennen.
 */
const STATUS_MAP: Record<string, { label: string; klass: string }> = {
  connected: { label: 'Verbonden', klass: 'badge-success' },
  disconnected: { label: 'Niet verbonden', klass: 'badge-neutral' },
  error: { label: 'Fout', klass: 'badge-danger' },
};

export function AccountingStatusPill({ status }: { status: string }) {
  const m = STATUS_MAP[status];
  if (!m) return <span className="badge badge-neutral">{status}</span>;
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}
