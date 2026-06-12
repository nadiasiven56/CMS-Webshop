import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { useAuth, useLogout } from '@/lib/auth';
import { navSectionsForRole } from '@/lib/nav-items';

function isActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname.startsWith(to);
}

export function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const auth = useAuth();
  const logout = useLogout();
  const navigate = useNavigate();
  const email = auth.data?.email ?? 'admin@webshop-crm.local';
  const initials = email.slice(0, 2).toUpperCase();
  // Role-bewuste navigatie: tenants ('user') zien geen admin-only secties.
  const sections = navSectionsForRole(auth.data?.role);

  async function onLogout() {
    await logout.mutateAsync();
    void navigate({ to: '/login' });
  }

  return (
    <aside className="app-sidebar">
      <div className="brand">
        <div className="brand-mark">W</div>
        <div className="brand-name">Webshop-CRM</div>
        <span className="brand-version">v0.1</span>
      </div>

      <nav aria-label="Hoofdnavigatie">
        {sections.map((section, si) => (
          <div key={si}>
            {section.label && <div className="nav-section-label">{section.label}</div>}
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className="nav-link"
                  data-active={active}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={15} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="user-pill" title={email}>
          <div className="avatar">{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--theme-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {email}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
              {auth.data?.role ?? 'admin'}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onLogout}
            disabled={logout.isPending}
            aria-label="Uitloggen"
            style={{ width: 28, height: 28 }}
            title="Uitloggen"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
