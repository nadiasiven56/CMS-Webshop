/**
 * Status-pill helper voor purchase-orders. Backend-statuses:
 * draft → ordered → partial → received / … → cancelled.
 */
import type { PoStatus } from './api';

export const PO_STATUS_META: Record<PoStatus, { label: string; klass: string }> = {
  draft: { label: 'Concept', klass: 'badge-neutral' },
  ordered: { label: 'Besteld', klass: 'badge-info' },
  partial: { label: 'Deels ontvangen', klass: 'badge-warning' },
  received: { label: 'Ontvangen', klass: 'badge-success' },
  cancelled: { label: 'Geannuleerd', klass: 'badge-danger' },
};

export function PoStatusPill({ status }: { status: PoStatus }) {
  const meta = PO_STATUS_META[status] ?? { label: status, klass: 'badge-neutral' };
  return <span className={`badge ${meta.klass}`}>{meta.label}</span>;
}

export const PO_STATUS_TABS: Array<{ value: PoStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'draft', label: 'Concept' },
  { value: 'ordered', label: 'Besteld' },
  { value: 'partial', label: 'Deels' },
  { value: 'received', label: 'Ontvangen' },
  { value: 'cancelled', label: 'Geannuleerd' },
];
