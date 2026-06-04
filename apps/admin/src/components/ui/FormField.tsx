import { type ReactNode } from 'react';

export interface FormFieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  /** Inline-grid 2-col layout if true (label left, field right). */
  inline?: boolean;
}

export function FormField({ label, hint, error, required, children, inline }: FormFieldProps) {
  if (inline) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr',
          gap: 12,
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        {label && (
          <label style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>
            {label}
            {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
          </label>
        )}
        <div>
          {children}
          {error && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
          {hint && !error && (
            <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--theme-muted)' }}>{hint}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
      {label && (
        <label
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--theme-muted)',
            letterSpacing: '0.02em',
          }}
        >
          {label}
          {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
        </label>
      )}
      {children}
      {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      {hint && !error && (
        <div style={{ fontSize: 11.5, color: 'var(--theme-muted)' }}>{hint}</div>
      )}
    </div>
  );
}
