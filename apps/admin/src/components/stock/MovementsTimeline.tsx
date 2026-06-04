import { DeltaBadge, type MovementRow } from './MovementsTable';

interface Props {
  rows: MovementRow[];
}

export function MovementsTimeline({ rows }: Props) {
  // Group by day (YYYY-MM-DD)
  const groups = rows.reduce<Map<string, MovementRow[]>>((acc, row) => {
    const date = new Date(row.createdAt);
    const day = date.toISOString().slice(0, 10);
    if (!acc.has(day)) acc.set(day, []);
    acc.get(day)!.push(row);
    return acc;
  }, new Map());

  const ordered = Array.from(groups.entries()).sort(([a], [b]) => (a < b ? 1 : -1));

  return (
    <div className="card">
      <div className="timeline">
        {ordered.map(([day, dayRows]) => (
          <div key={day}>
            <div className="timeline-day">{formatDayHeader(day)}</div>
            {dayRows.map((row) => (
              <div key={row.id} className="timeline-row">
                <span className="timeline-time">{formatTime(row.createdAt)}</span>
                <span
                  className={`timeline-marker ${row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : ''}`}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <DeltaBadge delta={row.delta} />
                  <span style={{ fontSize: 13, color: 'var(--theme-text)' }}>
                    <code className="mono" style={{ color: 'var(--theme-accent)' }}>
                      {row.itemSku ?? row.itemId.slice(0, 8)}
                    </code>
                    <span style={{ margin: '0 6px', color: 'var(--text-faint)' }}>·</span>
                    <span className="badge" style={{ textTransform: 'capitalize' }}>
                      {row.reason}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--theme-muted)' }}>
                    {row.location.name ?? '—'}
                  </span>
                  {row.note && (
                    <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                      "{row.note}"
                    </span>
                  )}
                  <span style={{ fontSize: 11.5, color: 'var(--text-faint)', marginLeft: 'auto' }}>
                    {row.actor?.email ?? 'system'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDayHeader(day: string): string {
  const d = new Date(day + 'T12:00:00');
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  const isToday = d.toDateString() === today.toDateString();
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const formatted = d.toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  if (isToday) return `Vandaag · ${formatted}`;
  if (isYesterday) return `Gisteren · ${formatted}`;
  return formatted;
}

function formatTime(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
