/**
 * Globale keyboard-shortcut hook.
 *
 * Patterns:
 *   useKeyboardShortcuts({
 *     'ctrl+s': () => save(),
 *     '/': () => focusSearch(),
 *     'n': () => createNew(),
 *     '?': () => showHelp(),
 *   });
 *
 * Negeert keys als focus in een input/textarea zit (behalve `Escape` + `Ctrl+S`).
 */
import { useEffect } from 'react';

export type ShortcutMap = Record<string, (e: KeyboardEvent) => void>;

function keyOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  const k = e.key.toLowerCase();
  parts.push(k);
  return parts.join('+');
}

const ALWAYS_FIRE = new Set(['escape', 'ctrl+s']);

export function useKeyboardShortcuts(shortcuts: ShortcutMap, deps: unknown[] = []) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = keyOf(e);
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName) ||
        (e.target as HTMLElement)?.getAttribute?.('contenteditable') === 'true';
      if (isInput && !ALWAYS_FIRE.has(key)) return;
      const handler = shortcuts[key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
