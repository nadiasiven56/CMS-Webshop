/**
 * Status-pill voor de ECHTE carrier-statuswaarden uit de backend
 * (`apps/api/src/routes/shipping/_schemas.ts`): disconnected | connected | error.
 *
 * Spiegelt channels/ChannelStatusPill.tsx — zelfde drie statussen, zelfde
 * badge-klassen.
 */
const STATUS_MAP: Record<string, { label: string; klass: string }> = {
  connected: { label: 'Verbonden', klass: 'badge-success' },
  disconnected: { label: 'Niet verbonden', klass: 'badge-neutral' },
  error: { label: 'Fout', klass: 'badge-danger' },
};

export function CarrierStatusPill({ status }: { status: string }) {
  const m = STATUS_MAP[status];
  if (!m) return <span className="badge badge-neutral">{status}</span>;
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}

// ─── Shipment-status-pill ──────────────────────────────────────
//
// pending | label_created | in_transit | delivered | error

const SHIPMENT_STATUS_MAP: Record<string, { label: string; klass: string }> = {
  pending: { label: 'In wachtrij', klass: 'badge-neutral' },
  label_created: { label: 'Label aangemaakt', klass: 'badge-info' },
  in_transit: { label: 'Onderweg', klass: 'badge-warning' },
  delivered: { label: 'Bezorgd', klass: 'badge-success' },
  error: { label: 'Fout', klass: 'badge-danger' },
};

export function ShipmentStatusPill({ status }: { status: string }) {
  const m = SHIPMENT_STATUS_MAP[status];
  if (!m) return <span className="badge badge-neutral">{status}</span>;
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}
