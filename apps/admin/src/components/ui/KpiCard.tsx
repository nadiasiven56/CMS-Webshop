import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: number;
  icon?: LucideIcon;
  size?: 'md' | 'sm';
  children?: ReactNode;
}

export function KpiCard({ label, value, hint, delta, icon: Icon, size, children }: Props) {
  const showDelta = typeof delta === 'number';
  const up = showDelta && delta! >= 0;

  return (
    <div className="kpi-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="kpi-label">{label}</span>
        {Icon && (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--theme-accent)',
              background: 'var(--theme-accent-subtle)',
              border: '1px solid var(--theme-accent-border)',
            }}
          >
            <Icon size={14} />
          </div>
        )}
      </div>
      <p className={`kpi-value ${size === 'sm' ? 'kpi-value-sm' : ''}`}>{value}</p>
      {showDelta && (
        <span className={`kpi-delta ${up ? 'kpi-delta-up' : 'kpi-delta-down'}`}>
          {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {up ? '+' : ''}
          {delta!.toFixed(1)}%
        </span>
      )}
      {hint && <p className="kpi-hint">{hint}</p>}
      {children}
    </div>
  );
}
