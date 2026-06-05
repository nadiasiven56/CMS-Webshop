import type { ReactNode, KeyboardEvent, CSSProperties } from 'react';

export interface ClickableRowProps {
  /** Activatie via klik, Enter of Spatie. */
  onActivate: () => void;
  children: ReactNode;
  /** Toegankelijke omschrijving van de bestemming (bv. "Open order CR-1024"). */
  ariaLabel?: string;
  style?: CSSProperties;
  className?: string;
}

/**
 * Toetsenbord-toegankelijke tabel-rij. Vervangt het patroon
 * `<tr onClick={..} style={{cursor:'pointer'}}>` dat geen keyboard-support had.
 *
 * - role="button" + tabIndex=0 → focusbaar en als knop aangekondigd.
 * - Enter / Spatie activeren (Spatie voorkomt page-scroll).
 * - Klikken op interactieve child-elementen (links/knoppen/inputs) bubbelt niet
 *   ongewenst de rij-navigatie: die elementen handelen hun eigen activatie af en
 *   we negeren keyboard-activatie wanneer de focus op zo'n control ligt.
 */
export function ClickableRow({
  onActivate,
  children,
  ariaLabel,
  style,
  className,
}: ClickableRowProps) {
  function isInteractiveTarget(el: EventTarget | null): boolean {
    const node = el as HTMLElement | null;
    if (!node || typeof node.closest !== 'function') return false;
    return !!node.closest('a, button, input, select, textarea, [role="button"]');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    // Laat genest interactief element (link/knop) zijn eigen actie doen.
    if (e.target !== e.currentTarget && isInteractiveTarget(e.target)) return;
    e.preventDefault();
    onActivate();
  }

  return (
    <tr
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (isInteractiveTarget(e.target)) return;
        onActivate();
      }}
      onKeyDown={onKeyDown}
      className={className}
      style={{ cursor: 'pointer', ...style }}
    >
      {children}
    </tr>
  );
}
