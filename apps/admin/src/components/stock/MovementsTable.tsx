export interface MovementRow {
  id: string;
  itemId: string;
  itemSku: string | null;
  location: {
    id: string | null;
    code: string | null;
    name: string | null;
  };
  delta: number;
  reason: string;
  refType: string | null;
  refId: string | null;
  actor: { id: string; email: string | null } | null;
  note: string | null;
  createdAt: string | Date;
}

interface Props {
  rows: MovementRow[];
  loading?: boolean;
  showItem?: boolean;
  emptyMessage?: string;
}

export function MovementsTable({ rows, loading, showItem = true, emptyMessage }: Props) {
  if (loading) {
    return (
      <div className="empty-state" style={{ padding: 24 }}>
        <p className="muted">Laden…</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 24 }}>
        <p className="muted">{emptyMessage ?? 'Geen mutaties gevonden.'}</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 130 }}>Datum</th>
            {showItem && <th>Item</th>}
            <th>Locatie</th>
            <th style={{ textAlign: 'right' }}>Delta</th>
            <th>Reden</th>
            <th>Actor</th>
            <th>Notitie</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div style={{ fontSize: 12.5, color: 'var(--theme-text)' }}>
                  {formatDate(row.createdAt)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  {formatTime(row.createdAt)}
                </div>
              </td>
              {showItem && (
                <td>
                  <code className="mono" style={{ color: 'var(--theme-accent)' }}>
                    {row.itemSku ?? row.itemId.slice(0, 8)}
                  </code>
                </td>
              )}
              <td>
                {row.location.name ?? <span className="muted">—</span>}
                {row.location.code && (
                  <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 4 }}>
                    ({row.location.code})
                  </span>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>
                <DeltaBadge delta={row.delta} />
              </td>
              <td>
                <span className="badge" style={{ textTransform: 'capitalize' }}>
                  {row.reason}
                </span>
              </td>
              <td>
                <span style={{ fontSize: 12.5 }}>
                  {row.actor?.email ?? <span className="muted">system</span>}
                </span>
              </td>
              <td>
                <span
                  title={row.note ?? undefined}
                  style={{
                    display: 'block',
                    maxWidth: 240,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 12.5,
                    color: 'var(--theme-muted)',
                  }}
                >
                  {row.note ?? '—'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeltaBadge({ delta }: { delta: number }) {
  const cls =
    delta > 0 ? 'badge-success' : delta === 0 ? 'badge-neutral' : 'badge-danger';
  return (
    <span
      className={`badge ${cls}`}
      style={{
        fontVariantNumeric: 'tabular-nums',
        minWidth: 48,
        justifyContent: 'center',
        fontWeight: 600,
      }}
    >
      {delta > 0 ? '+' : ''}
      {delta}
    </span>
  );
}

function formatDate(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: 'short',
  });
}

function formatTime(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
