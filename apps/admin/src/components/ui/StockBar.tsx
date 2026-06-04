interface Props {
  available: number;
  capacity?: number;
  showLabel?: boolean;
}

/**
 * Visualiseert voorraadniveau als horizontale bar.
 * - low: <=5
 * - medium: <=15
 * - high: >15
 */
export function StockBar({ available, capacity = 30, showLabel = true }: Props) {
  const pct = Math.max(2, Math.min(100, (available / capacity) * 100));
  const level: 'low' | 'medium' | 'high' =
    available <= 5 ? 'low' : available <= 15 ? 'medium' : 'high';

  return (
    <div className="stock-bar">
      <div className="stock-bar-track">
        <div className={`stock-bar-fill ${level}`} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && (
        <span className="stock-bar-label">
          <strong style={{ color: 'var(--theme-text)', fontWeight: 600 }}>{available}</strong>
          <span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>beschikbaar</span>
        </span>
      )}
    </div>
  );
}
