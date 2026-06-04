/**
 * ShopSwitcher — kiest de actieve shop (multi-shop). Staat in de TopBar.
 * Bij geen shops (verse install) toont het een hint naar /shops.
 */
import { Link } from '@tanstack/react-router';
import { Store, Plus } from 'lucide-react';
import { useActiveShop } from '@/lib/shop-context';

export function ShopSwitcher() {
  const { shops, activeShop, setActiveShop, isLoading } = useActiveShop();

  if (isLoading && shops.length === 0) {
    return (
      <div className="shop-switcher" aria-busy="true">
        <Store size={14} />
        <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>shops…</span>
      </div>
    );
  }

  if (shops.length === 0) {
    return (
      <Link to="/shops" className="shop-switcher" title="Maak je eerste shop">
        <Plus size={14} />
        <span style={{ fontSize: 12.5 }}>Shop toevoegen</span>
      </Link>
    );
  }

  return (
    <div className="shop-switcher" title="Actieve shop">
      <Store size={14} />
      <select
        aria-label="Actieve shop"
        value={activeShop?.id ?? ''}
        onChange={(e) => setActiveShop(e.target.value)}
      >
        {shops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
