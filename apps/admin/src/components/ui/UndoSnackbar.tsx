/**
 * Undo-snackbar — geschoten via een mini event-bus, zelfde patroon als Toast.
 *
 * Usage:
 *   import { undoBus } from '@/components/ui/UndoSnackbar';
 *   undoBus.push('Klant verwijderd', () => customerActions.restore(c));
 */
import { useEffect, useState } from 'react';
import { Undo2, X } from 'lucide-react';

interface UndoEvent {
  id: number;
  text: string;
  onUndo: () => void;
  expiresAt: number;
}

type Listener = (events: UndoEvent[]) => void;

class UndoBus {
  private events: UndoEvent[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;

  push(text: string, onUndo: () => void, durationMs = 5000) {
    const id = this.nextId++;
    const e: UndoEvent = { id, text, onUndo, expiresAt: Date.now() + durationMs };
    this.events = [...this.events, e];
    this.notify();
    setTimeout(() => this.dismiss(id), durationMs);
  }
  dismiss(id: number) {
    this.events = this.events.filter((e) => e.id !== id);
    this.notify();
  }
  undo(id: number) {
    const e = this.events.find((x) => x.id === id);
    if (!e) return;
    e.onUndo();
    this.dismiss(id);
  }
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.events);
    return () => { this.listeners.delete(fn); };
  }
  private notify() {
    this.listeners.forEach((fn) => fn(this.events));
  }
}

export const undoBus = new UndoBus();

export function UndoSnackbarContainer() {
  const [events, setEvents] = useState<UndoEvent[]>([]);
  useEffect(() => undoBus.subscribe(setEvents), []);
  if (events.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 95,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {events.map((e) => (
        <div
          key={e.id}
          className="toast"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--theme-card)',
            border: '1px solid var(--border-strong)',
            padding: '10px 14px',
            borderRadius: 10,
            minWidth: 320,
            boxShadow: 'var(--shadow-lg)',
            pointerEvents: 'auto',
          }}
        >
          <span style={{ flex: 1, fontSize: 13, color: 'var(--theme-text)' }}>{e.text}</span>
          <button
            type="button"
            onClick={() => undoBus.undo(e.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--theme-accent)',
              background: 'var(--theme-accent-subtle)',
              border: '1px solid var(--theme-accent-border)',
              borderRadius: 7,
              cursor: 'pointer',
            }}
          >
            <Undo2 size={12} /> Ongedaan
          </button>
          <button
            type="button"
            onClick={() => undoBus.dismiss(e.id)}
            aria-label="Sluiten"
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 24,
              height: 24,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-faint)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
