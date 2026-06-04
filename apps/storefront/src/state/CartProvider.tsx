/**
 * Cart-state. Houdt de cart-token in localStorage (per shop-slug aparte key),
 * maakt lazy een cart aan (POST /cart) wanneer de eerste add-to-cart gebeurt,
 * en biedt mutaties (add/update/remove) + live item-count voor de header.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../api/client';
import { cartTokenKey, getActiveShopSlug } from '../api/shop-context';
import type { Cart } from '../api/types';

interface CartState {
  cart: Cart | null;
  loading: boolean;
  /** itemCount voor de header-badge (0 als geen cart). */
  itemCount: number;
  /** Voegt een variant toe; maakt zonodig eerst een cart aan. Gooit ApiError. */
  addItem: (variantId: string, quantity?: number) => Promise<void>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Wis lokale token-state na een geslaagde checkout. */
  clearLocal: () => void;
}

const CartContext = createContext<CartState | null>(null);

function readToken(slug: string): string | null {
  try {
    return localStorage.getItem(cartTokenKey(slug));
  } catch {
    return null;
  }
}

function writeToken(slug: string, token: string): void {
  try {
    localStorage.setItem(cartTokenKey(slug), token);
  } catch {
    /* ignore */
  }
}

function dropToken(slug: string): void {
  try {
    localStorage.removeItem(cartTokenKey(slug));
  } catch {
    /* ignore */
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const slug = getActiveShopSlug();
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef<string | null>(readToken(slug));

  /** Zorg dat er een cart-token is; maak er anders eentje aan. */
  const ensureToken = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;
    const fresh = await api.createCart();
    tokenRef.current = fresh.token;
    writeToken(slug, fresh.token);
    setCart(fresh);
    return fresh.token;
  }, [slug]);

  const refresh = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    setLoading(true);
    try {
      const fresh = await api.getCart(token);
      setCart(fresh);
    } catch (err) {
      // token verlopen / niet (meer) geldig → opnieuw beginnen
      if (err instanceof ApiError && err.status === 404) {
        dropToken(slug);
        tokenRef.current = null;
        setCart(null);
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  // Bij mount: bestaande cart ophalen (badge-count).
  useEffect(() => {
    void refresh();
    // refresh is stabiel per slug
  }, [refresh]);

  const addItem = useCallback(
    async (variantId: string, quantity = 1) => {
      setLoading(true);
      try {
        const token = await ensureToken();
        const fresh = await api.addCartItem(token, variantId, quantity);
        setCart(fresh);
      } finally {
        setLoading(false);
      }
    },
    [ensureToken],
  );

  const updateItem = useCallback(
    async (itemId: string, quantity: number) => {
      const token = tokenRef.current;
      if (!token) return;
      setLoading(true);
      try {
        const fresh = await api.updateCartItem(token, itemId, quantity);
        setCart(fresh);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      const token = tokenRef.current;
      if (!token) return;
      setLoading(true);
      try {
        const fresh = await api.removeCartItem(token, itemId);
        setCart(fresh);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearLocal = useCallback(() => {
    dropToken(slug);
    tokenRef.current = null;
    setCart(null);
  }, [slug]);

  const value = useMemo<CartState>(
    () => ({
      cart,
      loading,
      itemCount: cart?.itemCount ?? 0,
      addItem,
      updateItem,
      removeItem,
      refresh,
      clearLocal,
    }),
    [cart, loading, addItem, updateItem, removeItem, refresh, clearLocal],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}

/** Token-helper voor de checkout-pagina (POST checkout heeft de token nodig). */
export function useCartToken(): string | null {
  return readToken(getActiveShopSlug());
}
