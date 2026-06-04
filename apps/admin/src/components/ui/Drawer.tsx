import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  width?: number;
  footer?: ReactNode;
  children?: ReactNode;
}

export function Drawer({ open, onClose, title, subtitle, width, footer, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        style={width ? { width } : undefined}
      >
        {(title || subtitle) && (
          <header className="drawer-header">
            <div style={{ minWidth: 0 }}>
              {title && (
                <h2
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 600,
                    letterSpacing: '-0.01em',
                    color: 'var(--theme-text)',
                  }}
                >
                  {title}
                </h2>
              )}
              {subtitle && (
                <div style={{ marginTop: 2, fontSize: 12.5, color: 'var(--theme-muted)' }}>
                  {subtitle}
                </div>
              )}
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Sluiten"
              style={{ width: 30, height: 30 }}
            >
              <X size={15} />
            </button>
          </header>
        )}
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-footer">{footer}</footer>}
      </aside>
    </>
  );
}
