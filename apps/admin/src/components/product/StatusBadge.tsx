import type { CSSProperties } from 'react';

type Status = 'draft' | 'active' | 'archived';

const STYLES: Record<Status, CSSProperties> = {
  draft: { color: 'var(--theme-muted)' },
  active: {
    color: 'var(--theme-success)',
    background: 'rgba(74, 222, 128, 0.12)',
    borderColor: 'rgba(74, 222, 128, 0.34)',
  },
  archived: {
    color: 'var(--theme-danger)',
    background: 'rgba(255, 107, 87, 0.12)',
    borderColor: 'rgba(255, 107, 87, 0.34)',
  },
};

const LABELS: Record<Status, string> = {
  draft: 'Concept',
  active: 'Actief',
  archived: 'Gearchiveerd',
};

export function StatusBadge({ status }: { status: string }) {
  const s = (status as Status) in STYLES ? (status as Status) : 'draft';
  return (
    <span className="pill" style={STYLES[s]}>
      {LABELS[s]}
    </span>
  );
}
