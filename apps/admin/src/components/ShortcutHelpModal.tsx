/**
 * Globale shortcut-help modal — open via `?` toets.
 */
import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { useKeyboardShortcuts } from '@/lib/use-keyboard-shortcuts';

const SHORTCUTS: Array<{ keys: string[]; desc: string; group: string }> = [
  { keys: ['Ctrl', 'K'], desc: 'Snelzoeken / navigeren', group: 'Algemeen' },
  { keys: ['?'], desc: 'Toon shortcuts', group: 'Algemeen' },
  { keys: ['Esc'], desc: 'Sluit drawer/modal/overlay', group: 'Algemeen' },
  { keys: ['Ctrl', 'S'], desc: 'Opslaan in actieve form', group: 'Algemeen' },
  { keys: ['/'], desc: 'Open snelzoeken', group: 'Lijsten' },
  { keys: ['n'], desc: 'Nieuwe entiteit op lijst-pagina', group: 'Lijsten' },
];

export function ShortcutHelpModal() {
  const [open, setOpen] = useState(false);

  useKeyboardShortcuts({
    'shift+?': () => setOpen(true),
    '?': () => setOpen(true),
  });

  // Close on route-change
  useEffect(() => {
    function onPop() { setOpen(false); }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const groups = Array.from(new Set(SHORTCUTS.map((s) => s.group)));

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard-shortcuts"
      subtitle="Versnel je workflow"
      maxWidth={460}
    >
      {groups.map((g) => (
        <div key={g} style={{ marginBottom: 16 }}>
          <h3 style={{
            fontSize: 11,
            color: 'var(--theme-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            margin: '0 0 8px',
          }}>{g}</h3>
          {SHORTCUTS.filter((s) => s.group === g).map((s, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}>
              <span style={{ fontSize: 13, color: 'var(--text-soft)' }}>{s.desc}</span>
              <span style={{ display: 'inline-flex', gap: 4 }}>
                {s.keys.map((k, j) => (
                  <kbd key={j} style={{
                    padding: '2px 7px',
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 5,
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    fontSize: 11,
                    color: 'var(--text-strong)',
                  }}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      ))}
    </Modal>
  );
}
