import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  LayoutDashboard,
  Package,
  Boxes,
  ListTree,
  Settings,
  LogOut,
  ShoppingCart,
  Users,
  Undo2,
  MapPin,
  ClipboardList,
  Truck,
  Globe,
  BarChart3,
  Receipt,
  BookOpenCheck,
  Store,
  FileText,
  Newspaper,
  Menu,
  Image as ImageIcon,
  Star,
  Webhook,
  ScrollText,
  Mail,
  Percent,
  Megaphone,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth, useLogout } from '@/lib/auth';

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard },
      { label: 'Shops', to: '/shops', icon: Store },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: "Pagina's", to: '/cms/pages', icon: FileText },
      { label: 'Blog', to: '/cms/blog', icon: Newspaper },
      { label: "Menu's", to: '/cms/menus', icon: Menu },
      { label: 'Media', to: '/cms/media', icon: ImageIcon },
    ],
  },
  {
    label: 'Verkoop',
    items: [
      { label: 'Orders', to: '/orders', icon: ShoppingCart },
      { label: 'Klanten', to: '/customers', icon: Users },
      { label: 'Retouren', to: '/returns', icon: Undo2 },
      { label: 'Reviews', to: '/reviews', icon: Star },
    ],
  },
  {
    label: 'Catalogus',
    items: [{ label: 'Producten', to: '/products', icon: Package }],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Voorraad', to: '/stock', icon: Boxes },
      { label: 'Movements', to: '/movements', icon: ListTree },
      { label: 'Locaties', to: '/locations', icon: MapPin },
      { label: 'Inkoop', to: '/purchase-orders', icon: ClipboardList },
      { label: 'Leveranciers', to: '/suppliers', icon: Truck },
      { label: 'Verzending', to: '/shipping', icon: Truck },
    ],
  },
  {
    label: 'Kanalen',
    items: [{ label: 'Verkoop-kanalen', to: '/channels', icon: Globe }],
  },
  {
    label: 'Financieel',
    items: [
      { label: 'Financieel', to: '/finance', icon: BarChart3 },
      { label: 'Boekhouding', to: '/accounting', icon: Receipt },
      { label: 'Boekhoud-koppeling', to: '/accounting/koppelingen', icon: Receipt },
      { label: 'Grootboek', to: '/ledger', icon: BookOpenCheck },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { label: 'Marketing', to: '/marketing', icon: Megaphone },
      { label: 'Kortingen', to: '/discounts', icon: Percent },
    ],
  },
  {
    label: 'Analytics',
    items: [{ label: 'Statistieken', to: '/analytics', icon: BarChart3 }],
  },
  {
    label: 'Communicatie',
    items: [{ label: 'E-mail', to: '/notifications', icon: Mail }],
  },
  {
    label: 'Systeem',
    items: [
      { label: 'Webhook-log', to: '/webhooks', icon: Webhook },
      { label: 'Audit-log', to: '/audit-log', icon: ScrollText },
    ],
  },
  {
    label: 'Account',
    items: [{ label: 'Settings', to: '/settings', icon: Settings }],
  },
];

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

      {SECTIONS.map((section, si) => (
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
              >
                <Icon size={15} strokeWidth={1.8} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}

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
