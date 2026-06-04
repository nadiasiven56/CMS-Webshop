/**
 * UploadProgressBar — per-bestand progress + error-state.
 */
import { AlertCircle, Loader2 } from 'lucide-react';

interface Props {
  filename: string;
  size: number;
  progress: number;
  error?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadProgressBar({ filename, size, progress, error }: Props) {
  return (
    <div
      style={{
        background: 'var(--theme-card2)',
        border: '1px solid var(--theme-border)',
        borderRadius: 8,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        {error ? (
          <AlertCircle size={14} color="var(--theme-danger)" />
        ) : (
          // Note: spinner-rotation requires `@keyframes spin` in global CSS.
          // styles.css doesn't define it yet — icon stays static, progress-bar
          // is the primary feedback signal anyway.
          <Loader2 size={14} color="var(--theme-accent)" />
        )}
        <span style={{ flex: 1, color: 'var(--theme-text)' }}>{filename}</span>
        <span style={{ color: 'var(--theme-muted)', fontSize: 12 }}>{formatBytes(size)}</span>
      </div>
      <div
        style={{
          height: 4,
          background: 'var(--theme-card)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${error ? 100 : progress}%`,
            height: '100%',
            background: error ? 'var(--theme-danger)' : 'var(--theme-accent)',
            transition: 'width 200ms ease',
          }}
        />
      </div>
      {error && (
        <div style={{ color: 'var(--theme-danger)', fontSize: 12 }}>{error}</div>
      )}
    </div>
  );
}
