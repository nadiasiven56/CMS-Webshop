import { useRouterState, Link } from '@tanstack/react-router';
import { Bell, Search, LayoutGrid } from 'lucide-react';
import { DEMO_MODE } from '@/lib/api-with-fallback';
import { ShopSwitcher } from '@/components/ShopSwitcher';

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

        <button type="button" className="topbar-search" aria-label="Search">
          <Search size={14} />
          <span>Zoeken…</span>
          <kbd>Ctrl K</kbd>
        </button>

        {DEMO_MODE && <span className="demo-pill">Demo Mode</span>}

        <button type="button" className="icon-btn" aria-label="Notifications" title="3 ongelezen">
          <Bell size={16} />
          <span className="notification-dot" />
        </button>
      </div>
    </header>
  );
}
