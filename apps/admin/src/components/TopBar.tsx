import { useEffect, useRef, useState } from 'react';
import { useRouterState, Link } from '@tanstack/react-router';
import { Bell, Search, LayoutGrid } from 'lucide-react';
import { DEMO_MODE } from '@/lib/api-with-fallback';
import { ShopSwitcher } from '@/components/ShopSwitcher';
import { openCommandPalette } from '@/components/CommandPalette';

interface RouteMeta {
  title: string;
  parents?: string[];
}

const ROUTE_TITLES: Record<string, RouteMeta> = {
  '/': { title: 'Dashboard' },
  '/products': { title: 'Producten', parents: ['Catalogus'] },
  '/products/new': { title: 'Nieuw product', parents: ['Catalogus', 'Producten'] },
  '/orders': { title: 'Orders', parents: ['Operations'] },
  '/stock': { title: 'Voorraad', parents: ['Operations'] },
  '/movements': { title: 'Movements', parents: ['Operations'] },
  '/settings': { title: 'Settings' },
};

function resolveMeta(pathname: string): RouteMeta {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname]!;
  if (pathname.startsWith('/products/')) return { title: 'Product detail', parents: ['Catalogus', 'Producten'] };
  if (pathname.startsWith('/stock/')) return { title: 'Voorraad detail', parents: ['Operations', 'Voorraad'] };
  return { title: 'Webshop-CRM' };
}

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const meta = resolveMeta(pathname);

  return (
    <header className="topbar">
      <div className="topbar-left">
        {meta.parents && (
          <div className="topbar-breadcrumbs">
            {meta.parents.map((p, i) => (
              <span key={i}>
                {p}
                <span style={{ margin: '0 6px', color: 'var(--text-faint)' }}>›</span>
              </span>
            ))}
          </div>
        )}
        <h1 className="topbar-title">{meta.title}</h1>
      </div>

      <div className="topbar-right">
        <Link to="/launch" className="topbar-allshops" title="Terug naar alle winkels">
          <LayoutGrid size={14} />
          <span>Alle winkels</span>
        </Link>
        <ShopSwitcher />

        <button
          type="button"
          className="topbar-search"
          aria-label="Zoeken (Ctrl K)"
          onClick={() => openCommandPalette()}
        >
          <Search size={14} />
          <span>Zoeken…</span>
          <kbd>Ctrl K</kbd>
        </button>

        {DEMO_MODE && <span className="demo-pill">Demo Mode</span>}

        <NotificationBell />
      </div>
    </header>
  );
}

/**
 * Notificatie-bel met een eenvoudige dropdown. We tonen GEEN fake "3 ongelezen"
 * meer (er is nog geen echte notificatie-feed). De dropdown legt dat eerlijk uit
 * en wijst door naar de e-mail-/webhook-pagina's. Zodra er een echte feed is,
 * kan deze lijst gevuld worden zonder de UI te wijzigen.
 */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Sluit bij klik buiten of Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Notificaties"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={16} />
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notificaties">
          <div className="notif-head">
            <span>Notificaties</span>
          </div>
          <div className="notif-empty">
            Geen nieuwe notificaties.
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link
                to="/notifications"
                className="btn btn-secondary btn-sm"
                onClick={() => setOpen(false)}
              >
                E-mail
              </Link>
              <Link
                to="/webhooks"
                className="btn btn-secondary btn-sm"
                onClick={() => setOpen(false)}
              >
                Webhook-log
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
