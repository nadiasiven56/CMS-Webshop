import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  maxWidth?: number;
  footer?: ReactNode;
  children?: ReactNode;
  /** When true, clicking the backdrop will NOT close the modal. */
  lockBackdrop?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  maxWidth = 480,
  footer,
  children,
  lockBackdrop,
}: ModalProps) {
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
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (lockBackdrop) return;
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="modal-card"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
      >
        {(title || subtitle) && (
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
              marginBottom: 14,
            }}
          >
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
                <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--theme-muted)' }}>
                  {subtitle}
                </div>
              )}
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Sluiten"
              style={{ width: 28, height: 28 }}
            >
              <X size={14} />
            </button>
          </header>
        )}
        <div>{children}</div>
        {footer && (
          <footer
            style={{
              marginTop: 18,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
