/**
 * SettingsTabs — gedeelde tab-navigatie voor de /settings-sectie.
 *
 * Wordt door het settings-LAYOUT (routes/_app/settings.tsx) één keer gerenderd,
 * bovenaan alle settings-pagina's. De actieve tab wordt afgeleid uit de huidige
 * route (useRouterState) zodat hij overal correct highlight, ongeacht waar hij
 * gerenderd wordt — er is dus geen `active`-prop meer nodig.
 *
 * NB: de CSS-klasse `.segmented` style alleen <button>; daarom zetten we de
 * actieve/inactieve look hier expliciet als inline-stijl op de <Link>'s zodat
 * de highlight ook zonder button-element zichtbaar is.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';

interface TabDef {
  to: string;
  label: string;
  /** Alleen voor role 'admin' (gebruikers-/token-/webhook-beheer is platform-breed). */
  adminOnly?: boolean;
}

const TABS: TabDef[] = [
  { to: '/settings', label: 'Account' },
  { to: '/settings/users', label: 'Gebruikers', adminOnly: true },
  { to: '/settings/tokens', label: 'Tokens', adminOnly: true },
  { to: '/settings/webhooks', label: 'Webhooks', adminOnly: true },
];

export function SettingsTabs() {
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });
  const auth = useAuth();
  const isAdmin = auth.data?.role === 'admin';
  const tabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  // De "Account"-tab (/settings) is alleen actief op exact /settings; de overige
  // tabs zijn actief zodra de pathname met hun pad begint.
  function isActive(to: string): boolean {
    if (to === '/settings') {
      return pathname === '/settings' || pathname === '/settings/';
    }
    return pathname === to || pathname.startsWith(to + '/');
  }

  return (
    <div className="segmented" style={{ marginBottom: 20 }}>
      {tabs.map((tab) => {
        const active = isActive(tab.to);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            data-active={active}
            style={{
              textDecoration: 'none',
              padding: '5px 12px',
              borderRadius: 6,
              fontSize: 12.5,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease)',
              background: active ? 'var(--surface-3)' : 'transparent',
              color: active ? 'var(--theme-text)' : 'var(--theme-muted)',
              boxShadow: active ? '0 1px 2px rgba(0, 0, 0, 0.4)' : 'none',
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
