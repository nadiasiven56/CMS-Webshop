import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export interface ToastMsg {
  id: string;
  kind: 'success' | 'error' | 'info';
  text: string;
}

interface Props {
  toast: ToastMsg;
  onDismiss: (id: string) => void;
}

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: AlertCircle,
};

export function Toast({ toast, onDismiss }: Props) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 2600);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  const Icon = ICONS[toast.kind];
  const cls = toast.kind === 'success' ? 'toast-success' : toast.kind === 'error' ? 'toast-error' : '';

  return (
    <div className={`toast ${cls}`}>
      <Icon size={16} />
      <span style={{ flex: 1 }}>{toast.text}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="icon-btn"
        style={{ width: 24, height: 24 }}
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastMsg[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/* Tiny global event-bus voor toasts */
let listeners: Array<(t: ToastMsg) => void> = [];
export const toastBus = {
  push(kind: ToastMsg['kind'], text: string) {
    const t: ToastMsg = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      kind,
      text,
    };
    listeners.forEach((fn) => fn(t));
  },
  subscribe(fn: (t: ToastMsg) => void) {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
};

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  useEffect(() => {
    return toastBus.subscribe((t) => setToasts((prev) => [...prev, t]));
  }, []);
  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }
  return { toasts, dismiss };
}
