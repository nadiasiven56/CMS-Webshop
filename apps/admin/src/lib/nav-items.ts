/**
 * Centrale navigatie-definitie — single source of truth voor zowel de Sidebar
 * als de command-palette (Ctrl/⌘K). Zo blijven menu en zoek altijd in sync.
 */
import {
  LayoutDashboard,
  Package,
  Boxes,
  ListTree,
  Settings,
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

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Extra zoekwoorden voor de command-palette (synoniemen). */
  keywords?: string;
  /** Alleen zichtbaar/toegankelijk voor role 'admin' (platform-operator). */
  adminOnly?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard, keywords: 'home start overzicht' },
      { label: 'Shops', to: '/shops', icon: Store, keywords: 'winkels stores' },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: "Pagina's", to: '/cms/pages', icon: FileText, keywords: 'cms content' },
      { label: 'Blog', to: '/cms/blog', icon: Newspaper, keywords: 'artikelen posts' },
      { label: "Menu's", to: '/cms/menus', icon: Menu, keywords: 'navigatie' },
      { label: 'Media', to: '/cms/media', icon: ImageIcon, keywords: "afbeeldingen foto's" },
    ],
  },
  {
    label: 'Verkoop',
    items: [
      { label: 'Orders', to: '/orders', icon: ShoppingCart, keywords: 'bestellingen verkoop' },
      { label: 'Klanten', to: '/customers', icon: Users, keywords: 'customers crm' },
      { label: 'Retouren', to: '/returns', icon: Undo2, keywords: 'returns rma' },
      { label: 'Reviews', to: '/reviews', icon: Star, keywords: 'beoordelingen', adminOnly: true },
    ],
  },
  {
    label: 'Catalogus',
    items: [{ label: 'Producten', to: '/products', icon: Package, keywords: 'catalogus artikelen' }],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Voorraad', to: '/stock', icon: Boxes, keywords: 'stock inventory' },
      { label: 'Movements', to: '/movements', icon: ListTree, keywords: 'mutaties voorraad' },
      { label: 'Locaties', to: '/locations', icon: MapPin, keywords: 'magazijnen warehouses', adminOnly: true },
      { label: 'Inkoop', to: '/purchase-orders', icon: ClipboardList, keywords: 'po purchase orders', adminOnly: true },
      { label: 'Leveranciers', to: '/suppliers', icon: Truck, keywords: 'suppliers', adminOnly: true },
      { label: 'Verzending', to: '/shipping', icon: Truck, keywords: 'shipping carriers', adminOnly: true },
    ],
  },
  {
    label: 'Kanalen',
    items: [{ label: 'Verkoop-kanalen', to: '/channels', icon: Globe, keywords: 'channels bol amazon', adminOnly: true }],
  },
  {
    label: 'Financieel',
    items: [
      { label: 'Financieel', to: '/finance', icon: BarChart3, keywords: 'finance omzet', adminOnly: true },
      { label: 'Boekhouding', to: '/accounting', icon: Receipt, keywords: 'accounting facturen', adminOnly: true },
      { label: 'Boekhoud-koppeling', to: '/accounting/koppelingen', icon: Receipt, keywords: 'moneybird exact', adminOnly: true },
      { label: 'Grootboek', to: '/ledger', icon: BookOpenCheck, keywords: 'ledger journaal', adminOnly: true },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { label: 'Marketing', to: '/marketing', icon: Megaphone, keywords: 'campagnes feeds', adminOnly: true },
      { label: 'Kortingen', to: '/discounts', icon: Percent, keywords: 'discounts vouchers codes' },
    ],
  },
  {
    label: 'Analytics',
    items: [{ label: 'Statistieken', to: '/analytics', icon: BarChart3, keywords: 'analytics stats', adminOnly: true }],
  },
  {
    label: 'Communicatie',
    items: [{ label: 'E-mail', to: '/notifications', icon: Mail, keywords: 'mail notificaties', adminOnly: true }],
  },
  {
    label: 'Systeem',
    items: [
      { label: 'Webhook-log', to: '/webhooks', icon: Webhook, keywords: 'webhooks deliveries', adminOnly: true },
      { label: 'Audit-log', to: '/audit-log', icon: ScrollText, keywords: 'audit logging', adminOnly: true },
    ],
  },
  {
    label: 'Account',
    items: [{ label: 'Settings', to: '/settings', icon: Settings, keywords: 'instellingen settings' }],
  },
];

/** Platte lijst van alle nav-items (handig voor de command-palette). */
export const NAV_ITEMS_FLAT: Array<NavItem & { section?: string }> = NAV_SECTIONS.flatMap(
  (section) => section.items.map((item) => ({ ...item, section: section.label })),
);

/* ─── Role-bewuste helpers ─────────────────────────────────────────────────
 *
 * Naast de nav-items zijn er admin-only ROUTES zonder eigen nav-item
 * (settings-subtabs). Die staan hier expliciet, zodat zowel de sidebar/
 * command-palette (via `adminOnly` op het item) als de route-guard
 * (via `isAdminOnlyPath`) uit ÉÉN bron putten.
 */
const EXTRA_ADMIN_ONLY_PATHS = ['/settings/users', '/settings/tokens', '/settings/webhooks'];

/** Alle route-prefixes die admin-only zijn (afgeleid van de nav + extra's). */
export const ADMIN_ONLY_PATHS: string[] = [
  ...NAV_ITEMS_FLAT.filter((i) => i.adminOnly).map((i) => i.to),
  ...EXTRA_ADMIN_ONLY_PATHS,
];

/** Mag deze role dit nav-item zien? */
export function canAccessNavItem(item: NavItem, role: string | undefined): boolean {
  return !item.adminOnly || role === 'admin';
}

/** Nav-secties gefilterd op role; secties zonder zichtbare items vallen weg. */
export function navSectionsForRole(role: string | undefined): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccessNavItem(item, role)),
  })).filter((section) => section.items.length > 0);
}

/** Is dit pad (of een sub-pad ervan) admin-only? Voor de route-guard in _app. */
export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}
