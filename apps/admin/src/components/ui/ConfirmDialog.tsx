import { type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Weet je het zeker?',
  message,
  confirmLabel = 'Bevestigen',
  cancelLabel = 'Annuleer',
  variant = 'danger',
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth={420}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 28,
              height: 28,
              borderRadius: 8,
              background: variant === 'danger' ? 'var(--danger-soft)' : 'var(--theme-accent-subtle)',
              color: variant === 'danger' ? 'var(--danger)' : 'var(--theme-accent)',
              border: `1px solid ${variant === 'danger' ? 'var(--danger-border)' : 'var(--theme-accent-border)'}`,
            }}
          >
            <AlertTriangle size={14} />
          </span>
          {title}
        </span>
      }
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={variant === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            autoFocus
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {message && (
        <div style={{ fontSize: 13.5, color: 'var(--text-soft)', lineHeight: 1.55 }}>
          {message}
        </div>
      )}
    </Modal>
  );
}
