/**
 * Status-pill voor een shop. Statussen: active | draft | paused.
 * Hergebruikt de `.pill` CSS-class + thema-tokens (geen nieuwe stijl).
 */
import type { CSSProperties } from 'react';

type Status = 'active' | 'draft' | 'paused';

const STYLES: Record<Status, CSSProperties> = {
  active: {
    color: 'var(--theme-success)',
    background: 'rgba(74, 222, 128, 0.12)',
    borderColor: 'rgba(74, 222, 128, 0.34)',
  },
  draft: { color: 'var(--theme-muted)' },
  paused: {
    color: 'var(--theme-warning, #f5a623)',
    background: 'rgba(245, 166, 35, 0.12)',
    borderColor: 'rgba(245, 166, 35, 0.34)',
  },
};

const LABELS: Record<Status, string> = {
  active: 'Actief',
  draft: 'Concept',
  paused: 'Gepauzeerd',
};

export function ShopStatusBadge({ status }: { status: string }) {
  const s = (status as Status) in STYLES ? (status as Status) : 'draft';
  return (
    <span className="pill" style={STYLES[s]}>
      {LABELS[s]}
    </span>
  );
}
