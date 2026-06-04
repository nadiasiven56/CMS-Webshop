# Sidebar wiring — preview pages (Atlas)

**Voor**: Atlas (na Aether's design-pass) — `apps/admin/src/components/Sidebar.tsx`

Hieronder de uitbreiding van de SECTIONS-array. Bestaande items blijven, nieuwe items in **NEW**. Iconen uit `lucide-react` (al geïnstalleerd).

## Imports toevoegen aan Sidebar.tsx

```tsx
import {
  // bestaand:
  LayoutDashboard, Package, Boxes, ListTree, Settings, LogOut,
  // nieuw:
  ShoppingCart,      // Orders
  Users,             // Customers
  Undo2,             // Returns
  MapPin,            // Locations
  ClipboardList,     // Purchase orders
  Truck,             // Suppliers
  Globe,             // Channels
  BarChart3,         // Finance
  Receipt,           // Accounting
  BookOpenCheck,     // Ledger
} from 'lucide-react';
```

## SECTIONS-uitbreiding

```tsx
const SECTIONS: NavSection[] = [
  // bestaand
  {
    items: [{ label: 'Dashboard', to: '/', icon: LayoutDashboard }],
  },

  // NIEUWE SECTION — Verkoop
  {
    label: 'Verkoop',
    items: [
      { label: 'Orders', to: '/orders', icon: ShoppingCart },          // NEW (badge=getOrdersOpenCount)
      { label: 'Klanten', to: '/customers', icon: Users },             // NEW
      { label: 'Retouren', to: '/returns', icon: Undo2 },              // NEW (badge=getReturnsOpenCount)
    ],
  },

  // bestaand uitgebreid
  {
    label: 'Catalogus',
    items: [{ label: 'Producten', to: '/products', icon: Package }],
  },

  // bestaand uitgebreid met locations + inkoop + leveranciers
  {
    label: 'Operations',
    items: [
      { label: 'Voorraad', to: '/stock', icon: Boxes },
      { label: 'Movements', to: '/movements', icon: ListTree },
      { label: 'Locaties', to: '/locations', icon: MapPin },           // NEW
      { label: 'Inkoop', to: '/purchase-orders', icon: ClipboardList },// NEW
      { label: 'Leveranciers', to: '/suppliers', icon: Truck },        // NEW
    ],
  },

  // NIEUWE SECTION — Kanalen
  {
    label: 'Kanalen',
    items: [
      { label: 'Verkoop-kanalen', to: '/channels', icon: Globe },      // NEW
      // /channels/matrix is sub-page — geen sidebar-item; bereikbaar via knop op /channels
    ],
  },

  // NIEUWE SECTION — Financieel
  {
    label: 'Financieel',
    items: [
      { label: 'Financieel', to: '/finance', icon: BarChart3 },        // NEW
      { label: 'Boekhouding', to: '/accounting', icon: Receipt },      // NEW
      { label: 'Grootboek', to: '/ledger', icon: BookOpenCheck },      // NEW
    ],
  },

  // bestaand
  {
    label: 'Account',
    items: [{ label: 'Settings', to: '/settings', icon: Settings }],
  },
];
```

## Optionele badges (na visie-pass)

Voor `Orders` en `Retouren` kan een count-badge op het nav-item — gebruik:
```tsx
import { getOrdersOpenCount, getReturnsOpenCount } from '@/lib/mock-data-extended';

// in render:
{item.label === 'Orders' && (
  <span className="seg-count" style={{ marginLeft: 'auto' }}>{getOrdersOpenCount()}</span>
)}
```

## Settings-tabs (sub-navigation)

`/settings/users`, `/settings/tokens`, `/settings/webhooks` zijn **sub-tabs binnen settings.tsx**, niet aparte sidebar-items. Ze worden bereikt via de `<SettingsTabs>`-component die in elke settings-page geëxporteerd is (zie `routes/_app/settings.users.tsx`).

Eventueel kan Atlas in `/settings` (de bestaande page van Aether) ook deze tabs renderen — door `<SettingsTabs active="general" />` toe te voegen.

## Niet in sidebar (sub-routes / detail-pages)

- `/orders/$id` — bereikt via klik op order-rij in `/orders`
- `/channels/matrix` — bereikt via knop op `/channels`
- `/settings/users|tokens|webhooks` — tabs binnen Settings

## Mobile-collapse

Dit zou veel pills geven op een mobile horizontal-scroll bar. Als dit te druk wordt: collapse `Operations` en `Financieel` items achter een "Meer …"-overlay-menu. Voor nu (preview): laat alle items zichtbaar voor maximaal effect — de horizontal-scroll werkt vanzelf via bestaande CSS.
