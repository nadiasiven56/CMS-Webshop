/**
 * Shop-context — de actieve shop voor de hele admin (multi-shop).
 *
 * Bijna elke commerce/CMS-pagina is shop-scoped. Deze context levert de
 * gekozen shop + setter, gepersisteerd in localStorage. Gebruik in pages:
 *
 *   const { activeShopId, activeShop, shops } = useActiveShop();
 *   const q = useQuery({ queryKey: ['orders', activeShopId], ... });
 *
 * De shop-switcher in de TopBar muteert dit. Bij shop-wissel her-queryen
 * pages doordat `activeShopId` in hun queryKey zit.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { listShops } from './api-with-fallback';

export interface Shop {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  locale: string;
  currency: string;
  status: string;
  branding?: Record<string, unknown>;
  vatConfig?: Record<string, unknown>;
  supportEmail?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const ACTIVE_SHOP_LS_KEY = 'webshop-crm.active-shop';
const LS_KEY = ACTIVE_SHOP_LS_KEY;

/**
 * Zet de actieve shop buiten de provider (bv. vanuit de launcher-route, die
 * buiten <ShopProvider> staat). De ShopProvider in _app leest deze key bij
 * (her)mount, dus de gekozen shop is meteen actief in de admin-shell.
 */
export function persistActiveShop(id: string): void {
  try {
    localStorage.setItem(ACTIVE_SHOP_LS_KEY, id);
  } catch {
    /* ignore */
  }
}

interface ShopContextValue {
  shops: Shop[];
  activeShop: Shop | null;
  activeShopId: string | null;
  setActiveShop: (id: string) => void;
  isLoading: boolean;
  refetch: () => void;
}

const ShopContext = createContext<ShopContextValue | null>(null);

export const SHOPS_QUERY_KEY = ['shops', 'all'] as const;

export function ShopProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: SHOPS_QUERY_KEY,
    queryFn: () => listShops(),
    staleTime: 30_000,
  });

  const shops = data ?? [];
  const [activeId, setActiveId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null,
  );

  // Zorg dat de actieve shop geldig is zodra shops geladen zijn.
  useEffect(() => {
    if (shops.length === 0) return;
    if (!activeId || !shops.some((s) => s.id === activeId)) {
      const next = shops[0]!.id;
      setActiveId(next);
      try {
        localStorage.setItem(LS_KEY, next);
      } catch {
        /* ignore */
      }
    }
  }, [shops, activeId]);

  const setActiveShop = (id: string) => {
    setActiveId(id);
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const activeShop = shops.find((s) => s.id === activeId) ?? shops[0] ?? null;

  return (
    <ShopContext.Provider
      value={{
        shops,
        activeShop,
        activeShopId: activeShop?.id ?? null,
        setActiveShop,
        isLoading,
        refetch,
      }}
    >
      {children}
    </ShopContext.Provider>
  );
}

export function useActiveShop(): ShopContextValue {
  const ctx = useContext(ShopContext);
  if (!ctx) {
    throw new Error('useActiveShop must be used within <ShopProvider>');
  }
  return ctx;
}
