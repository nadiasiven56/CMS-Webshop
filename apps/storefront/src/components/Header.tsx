import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ShopLink } from './ShopLink';
import { api } from '../api/client';
import { useShop } from '../state/ShopProvider';
import { useCart } from '../state/CartProvider';
import { getActiveShopSlug } from '../api/shop-context';
import type { Menu, MenuItem } from '../api/types';

/** Header-menu uit de CMS; valt terug op een minimaal default-menu. */
function useHeaderMenu(): MenuItem[] {
  const [items, setItems] = useState<MenuItem[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    api
      .listMenus(ctrl.signal)
      .then((menus: Menu[]) => {
        const header =
          menus.find((m) => m.location === 'header') ?? menus[0] ?? null;
        setItems(header?.items ?? []);
      })
      .catch(() => {
        setItems([
          { id: 'h', parentId: null, label: 'Home', url: '/', position: 0, children: [] },
          { id: 's', parentId: null, label: 'Shop', url: '/shop', position: 1, children: [] },
          { id: 'b', parentId: null, label: 'Blog', url: '/blog', position: 2, children: [] },
        ]);
      });
    return () => ctrl.abort();
  }, []);
  return items;
}

export function Header() {
  const { shop } = useShop();
  const { itemCount } = useCart();
  const menu = useHeaderMenu();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const activeSlug = getActiveShopSlug();

  // sluit het mobiele menu bij route-wissel
  useEffect(() => setOpen(false), [location.pathname]);

  const initials = (shop?.name ?? 'Shop').slice(0, 1).toUpperCase();

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <ShopLink to="/" className="brand-mark">
          <span className="brand-mark__dot">{initials}</span>
          {shop?.name ?? 'Webshop'}
        </ShopLink>

        <nav className={`main-nav ${open ? 'open' : ''}`}>
          {menu.map((item) => {
            const isActive =
              item.url === location.pathname ||
              (item.url !== '/' && location.pathname.startsWith(item.url));
            return (
              <ShopLink
                key={item.id}
                to={item.url}
                className={isActive ? 'active' : ''}
              >
                {item.label}
              </ShopLink>
            );
          })}
        </nav>

        <div className="header-actions">
          {/* Demo: schakel tussen de twee shops */}
          <div className="shop-switcher" title="Wissel demo-shop">
            <a
              href="?shop=crema"
              className={activeSlug === 'crema' ? 'active' : ''}
            >
              Crema
            </a>
            <a
              href="?shop=pawfect"
              className={activeSlug === 'pawfect' ? 'active' : ''}
            >
              Pawfect
            </a>
          </div>

          <ShopLink to="/cart" className="cart-button" aria-label="Winkelwagen">
            <span aria-hidden>🛒</span>
            <span>Wagen</span>
            {itemCount > 0 && <span className="badge">{itemCount}</span>}
          </ShopLink>
        </div>

        <button
          className="btn btn-outline nav-toggle"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          ☰
        </button>
      </div>
    </header>
  );
}
