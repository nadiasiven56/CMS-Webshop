/**
 * useFocusTrap — houdt Tab-focus binnen een dialog/overlay, zet initiële focus
 * en herstelt focus naar het trigger-element bij sluiten.
 *
 * Gebruik:
 *   const ref = useRef<HTMLElement>(null);
 *   useFocusTrap(ref, open);
 *   <aside ref={ref} role="dialog">…</aside>
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Onthoud waar de focus vandaan kwam, zodat we 'm kunnen herstellen.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Initiële focus: eerste focusbare element, anders de container zelf.
    const initial = focusableWithin(container);
    if (initial.length > 0) {
      initial[0]!.focus();
    } else {
      container.setAttribute('tabindex', '-1');
      container.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const focusable = focusableWithin(container!);
      if (focusable.length === 0) {
        e.preventDefault();
        container!.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeEl = document.activeElement;

      if (e.shiftKey) {
        if (activeEl === first || !container!.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !container!.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Focus terug naar de trigger (indien nog in de DOM en focusbaar).
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef]);
}
