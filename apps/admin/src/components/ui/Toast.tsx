import { useEffect, useRef, useState } from 'react';
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

const AUTO_DISMISS_MS = 2600;

export function Toast({ toast, onDismiss }: Props) {
  // Pauzeer de auto-dismiss zolang de gebruiker hovert of focus heeft op de
  // toast, zodat berichten (incl. errors) lang genoeg leesbaar blijven en de
  // dismiss-knop bereikbaar is. We hervatten met de resterende tijd.
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(AUTO_DISMISS_MS);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    if (paused) return;
    startedAtRef.current = Date.now();
    const t = setTimeout(() => onDismiss(toast.id), remainingRef.current);
    return () => {
      clearTimeout(t);
      // Bewaar resterende tijd bij pauze (cleanup loopt vóór de volgende run).
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (Date.now() - startedAtRef.current),
      );
    };
  }, [paused, toast.id, onDismiss]);

  const Icon = ICONS[toast.kind];
  const cls = toast.kind === 'success' ? 'toast-success' : toast.kind === 'error' ? 'toast-error' : '';

  return (
    <div
      className={`toast ${cls}`}
      // Errors lezen we direct voor (assertive); overige berichten beleefd.
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <Icon size={16} />
      <span style={{ flex: 1 }}>{toast.text}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="icon-btn"
        style={{ width: 24, height: 24 }}
        aria-label="Sluiten"
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
  // Container blijft altijd in de DOM (ook leeg) zodat de live-region door
  // assistive tech wordt gevolgd en nieuwe toasts worden aangekondigd.
  return (
    <div
      className="toast-container"
      role="region"
      aria-label="Meldingen"
      aria-live="polite"
    >
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
