/**
 * SyncLogTable — toont de append-only accounting_sync_log van één koppeling
 * (entityType, status, message, externalId, tijd). Eigen empty/loading/error.
 *
 * Leest via useSyncLog(connectionId). Newest-first (backend sorteert al).
 */
import { ScrollText, AlertTriangle } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useSyncLog, type AccountingSyncLogDto } from './api';

const ENTITY_LABELS: Record<string, string> = {
  invoice: 'Factuur',
  order: 'Order',
  ledger_batch: 'Grootboek',
};

function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; klass: string }> = {
    synced: { label: 'Gesynct', klass: 'badge-success' },
    error: { label: 'Fout', klass: 'badge-danger' },
    pending: { label: 'In wachtrij', klass: 'badge-warning' },
  };
  const m = map[status];
  if (!m) return <span className="badge badge-neutral">{status}</span>;
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}

export function SyncLogTable({ connectionId }: { connectionId: string }) {
  const query = useSyncLog(connectionId, { limit: 100 });
  const items: AccountingSyncLogDto[] = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  if (query.isError) {
    return (
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <p className="error-text" style={{ color: 'var(--danger)' }}>
          Kon het sync-log niet laden. Probeer een pagina-refresh.
        </p>
      </div>
    );
  }

  if (query.isLoading) {
    return <SkeletonTableRows rows={6} />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title="Nog geen sync-historie"
        description="Zodra je synchroniseert verschijnt hier per factuur/order een regel met de uitkomst."
      />
    );
  }

  return (
    <div className="card card-flush">
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Status</th>
              <th>Bericht</th>
              <th>Extern ID</th>
              <th>Tijd</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className="badge badge-neutral">{entityLabel(row.entityType)}</span>
                </td>
                <td>{statusBadge(row.status)}</td>
                <td style={{ fontSize: 12.5, color: 'var(--theme-muted)', maxWidth: 360 }}>
                  {row.status === 'error' && row.message ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        color: 'var(--danger)',
                      }}
                    >
                      <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                      {row.message}
                    </span>
                  ) : (
                    row.message ?? '—'
                  )}
                </td>
                <td className="mono" style={{ fontSize: 11.5, color: 'var(--theme-muted)' }}>
                  {row.externalId ?? '—'}
                </td>
                <td
                  style={{ fontSize: 12.5, color: 'var(--theme-muted)', whiteSpace: 'nowrap' }}
                  title={formatDateTime(row.createdAt)}
                >
                  {formatRelative(row.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > items.length && (
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-faint)' }}>
          Toont meest recente {items.length} van {total} regels.
        </div>
      )}
    </div>
  );
}
