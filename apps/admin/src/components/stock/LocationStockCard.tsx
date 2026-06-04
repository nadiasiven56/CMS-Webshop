import { AlertTriangle, MapPin } from 'lucide-react';

export interface LocationStock {
  locationId: string;
  code: string;
  name: string;
  type: string;
  onHand: number;
  available: number;
  committed: number;
  incoming: number;
  minStock: number | null;
  reorderPoint: number | null;
  reorderQty: number | null;
  lowStock: boolean;
}

interface Props {
  level: LocationStock;
  onAdjust: (level: LocationStock) => void;
}

export function LocationStockCard({ level, onAdjust }: Props) {
  const minStock = level.minStock ?? 5;
  const reorderPoint = level.reorderPoint ?? minStock + 5;
  const target = Math.max(reorderPoint * 2, level.available + 1, 20);
  const fillPct = Math.max(2, Math.min(100, (level.available / target) * 100));
  const fillClass = level.available <= minStock ? 'low' : level.available <= reorderPoint ? 'medium' : 'high';

  return (
    <div
      className="card"
      style={{
        padding: 16,
        position: 'relative',
        borderLeft: level.lowStock ? '3px solid var(--warning)' : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--theme-text)' }}>
              {level.name}
            </h3>
            {level.lowStock && (
              <span className="badge badge-warning" style={{ fontSize: 10.5 }}>
                <AlertTriangle size={10} />
                Low
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={11} />
            <code className="mono">{level.code}</code>
            <span>·</span>
            <span style={{ textTransform: 'capitalize' }}>{level.type}</span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onAdjust(level)}
        >
          Adjust
        </button>
      </div>

      {/* Stock-meter */}
      <div style={{ marginTop: 14 }}>
        <div className="stock-bar-track" style={{ height: 8 }}>
          <div className={`stock-bar-fill ${fillClass}`} style={{ width: `${fillPct}%` }} />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
            fontSize: 11,
            color: 'var(--text-faint)',
          }}
        >
          <span>0</span>
          {level.minStock != null && (
            <span style={{ color: 'var(--warning)' }}>min {level.minStock}</span>
          )}
          {level.reorderPoint != null && <span>reorder {level.reorderPoint}</span>}
          <span>{target}</span>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 8,
          marginTop: 12,
        }}
      >
        <Stat label="On hand" value={level.onHand} />
        <Stat label="Available" value={level.available} highlight={level.available <= 0} />
        <Stat label="Committed" value={level.committed} muted />
        <Stat label="Incoming" value={level.incoming} muted />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
  muted,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: '8px 10px',
      }}
    >
      <div className="kpi-label" style={{ fontSize: 10.5 }}>{label}</div>
      <div
        style={{
          fontSize: 17,
          fontWeight: 700,
          marginTop: 2,
          color: highlight
            ? 'var(--danger)'
            : muted
              ? 'var(--theme-muted)'
              : 'var(--text-strong)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  );
}
