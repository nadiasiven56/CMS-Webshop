/**
 * Command-palette — globale zoek/navigatie-overlay op Ctrl/⌘K.
 *
 * - Fuzzy-ish client-side filter over de hoofd-navigatie (NAV_ITEMS_FLAT) +
 *   een paar snelle acties (nieuw product/order/klant).
 * - Toetsenbord: ↑/↓ selecteren, Enter navigeren, Esc sluiten.
 * - Open via Ctrl/⌘K (en via de TopBar-zoekknop / '/'-shortcut).
 *
 * Luistert op een globaal custom-event zodat ook de TopBar-knop en de
 * '/'-shortcut 'm kunnen openen zonder prop-drilling.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Search, CornerDownLeft, Plus, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NAV_ITEMS_FLAT } from '@/lib/nav-items';

const OPEN_EVENT = 'webshop-crm:open-command-palette';

/** Open de palette van buitenaf (TopBar-knop, '/'-shortcut). */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

interface Command {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  hint?: string;
  keywords?: string;
  group: string;
}

const QUICK_ACTIONS: Command[] = [
  { id: 'new-product', label: 'Nieuw product', to: '/products/new', icon: Plus, hint: 'Aanmaken', group: 'Acties', keywords: 'toevoegen create' },
  { id: 'new-order', label: 'Nieuwe order', to: '/orders', icon: Plus, hint: 'Open orders', group: 'Acties', keywords: 'bestelling handmatig' },
  { id: 'new-customer', label: 'Nieuwe klant', to: '/customers', icon: Plus, hint: 'Open klanten', group: 'Acties', keywords: 'customer toevoegen' },
];

const NAV_COMMANDS: Command[] = NAV_ITEMS_FLAT.map((item) => ({
  id: `nav-${item.to}`,
  label: item.label,
  to: item.to,
  icon: item.icon,
  keywords: item.keywords,
  group: item.section ?? 'Navigatie',
}));

const ALL_COMMANDS: Command[] = [...QUICK_ACTIONS, ...NAV_COMMANDS];

function score(cmd: Command, q: string): number {
  if (!q) return 1;
  const hay = `${cmd.label} ${cmd.keywords ?? ''} ${cmd.group}`.toLowerCase();
  const needle = q.toLowerCase();
  const label = cmd.label.toLowerCase();
  if (label === needle) return 100;
  if (label.startsWith(needle)) return 80;
  if (label.includes(needle)) return 60;
  if (hay.includes(needle)) return 40;
  // sub-sequence match (alle tekens in volgorde)
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return 20;
  }
  return 0;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Open via Ctrl/⌘K en via het globale event.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        doOpen();
      }
    }
    function onOpenEvent() {
      doOpen();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function doOpen() {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActiveIdx(0);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    if (restoreFocusRef.current && typeof restoreFocusRef.current.focus === 'function') {
      restoreFocusRef.current.focus();
    }
  }

  // Focus input + lock scroll wanneer open.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim();
    return ALL_COMMANDS.map((cmd) => ({ cmd, s: score(cmd, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((r) => r.cmd);
  }, [query]);

  // Houd activeIdx binnen bereik bij wijzigende resultaten.
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  function runCommand(cmd: Command | undefined) {
    if (!cmd) return;
    close();
    void navigate({ to: cmd.to });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runCommand(results[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  // Scroll actief item in beeld.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      role="presentation"
      style={{ alignItems: 'flex-start', paddingTop: '12vh' }}
    >
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Snelzoeken en navigeren"
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-input-row">
          <Search size={16} style={{ color: 'var(--theme-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="cmdk-input"
            type="text"
            placeholder="Zoek pagina's of acties…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Zoekopdracht"
            aria-activedescendant={results[activeIdx] ? `cmdk-opt-${activeIdx}` : undefined}
            role="combobox"
            aria-expanded
            aria-controls="cmdk-listbox"
            autoComplete="off"
          />
          <kbd className="cmdk-esc">Esc</kbd>
        </div>

        <div className="cmdk-results" ref={listRef} id="cmdk-listbox" role="listbox">
          {results.length === 0 ? (
            <div className="cmdk-empty">Geen resultaten voor “{query}”.</div>
          ) : (
            results.map((cmd, idx) => {
              const Icon = cmd.icon;
              const active = idx === activeIdx;
              return (
                <button
                  key={cmd.id}
                  type="button"
                  id={`cmdk-opt-${idx}`}
                  data-idx={idx}
                  role="option"
                  aria-selected={active}
                  className="cmdk-item"
                  data-active={active}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => runCommand(cmd)}
                >
                  <Icon size={15} style={{ color: 'var(--theme-muted)', flexShrink: 0 }} />
                  <span className="cmdk-item-label">{cmd.label}</span>
                  <span className="cmdk-item-group">{cmd.hint ?? cmd.group}</span>
                  {active ? (
                    <CornerDownLeft size={13} style={{ color: 'var(--theme-accent)' }} />
                  ) : (
                    <ArrowRight size={13} style={{ color: 'var(--text-faint)' }} />
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigeren</span>
          <span><kbd>↵</kbd> openen</span>
          <span><kbd>esc</kbd> sluiten</span>
        </div>
      </div>
    </div>
  );
}
