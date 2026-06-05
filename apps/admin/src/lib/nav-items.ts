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
      { label: 'Reviews', to: '/reviews', icon: Star, keywords: 'beoordelingen' },
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
      { label: 'Locaties', to: '/locations', icon: MapPin, keywords: 'magazijnen warehouses' },
      { label: 'Inkoop', to: '/purchase-orders', icon: ClipboardList, keywords: 'po purchase orders' },
      { label: 'Leveranciers', to: '/suppliers', icon: Truck, keywords: 'suppliers' },
      { label: 'Verzending', to: '/shipping', icon: Truck, keywords: 'shipping carriers' },
    ],
  },
  {
    label: 'Kanalen',
    items: [{ label: 'Verkoop-kanalen', to: '/channels', icon: Globe, keywords: 'channels bol amazon' }],
  },
  {
    label: 'Financieel',
    items: [
      { label: 'Financieel', to: '/finance', icon: BarChart3, keywords: 'finance omzet' },
      { label: 'Boekhouding', to: '/accounting', icon: Receipt, keywords: 'accounting facturen' },
      { label: 'Boekhoud-koppeling', to: '/accounting/koppelingen', icon: Receipt, keywords: 'moneybird exact' },
      { label: 'Grootboek', to: '/ledger', icon: BookOpenCheck, keywords: 'ledger journaal' },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { label: 'Marketing', to: '/marketing', icon: Megaphone, keywords: 'campagnes feeds' },
      { label: 'Kortingen', to: '/discounts', icon: Percent, keywords: 'discounts vouchers codes' },
    ],
  },
  {
    label: 'Analytics',
    items: [{ label: 'Statistieken', to: '/analytics', icon: BarChart3, keywords: 'analytics stats' }],
  },
  {
    label: 'Communicatie',
    items: [{ label: 'E-mail', to: '/notifications', icon: Mail, keywords: 'mail notificaties' }],
  },
  {
    label: 'Systeem',
    items: [
      { label: 'Webhook-log', to: '/webhooks', icon: Webhook, keywords: 'webhooks deliveries' },
      { label: 'Audit-log', to: '/audit-log', icon: ScrollText, keywords: 'audit logging' },
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
