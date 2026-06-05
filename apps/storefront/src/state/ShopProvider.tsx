/**
 * Laadt de actieve shop (GET /shop) en zet branding-kleuren als CSS-variabelen
 * op :root, zodat de look zich per shop aanpast (crema = bruin/oranje,
 * pawfect = groen).
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../api/client';
import { getActiveShopSlug } from '../api/shop-context';
import { injectStorefrontTags } from '../analytics/tags';
import type { Shop } from '../api/types';

interface ShopState {
  shop: Shop | null;
  slug: string;
  loading: boolean;
  error: string | null;
}

const ShopContext = createContext<ShopState | null>(null);

function applyBranding(shop: Shop): void {
  const root = document.documentElement;
  const primary = shop.branding?.primaryColor;
  const accent = shop.branding?.accentColor;
  if (primary) root.style.setProperty('--brand-primary', primary);
  if (accent) root.style.setProperty('--brand-accent', accent);
  // afgeleide, zachte tint voor achtergronden
  if (primary) {
    root.style.setProperty(
      '--brand-primary-soft',
      `color-mix(in srgb, ${primary} 8%, white)`,
    );
    root.style.setProperty(
      '--brand-primary-tint',
      `color-mix(in srgb, ${primary} 14%, transparent)`,
    );
  }
  document.title = shop.name;
  // Zet de document-taal op de shop-locale (bv. 'nl-NL' → <html lang="nl-NL">)
  // voor toegankelijkheid + correcte hyphenation/spraak.
  if (shop.locale) root.lang = shop.locale;
}

export function ShopProvider({ children }: { children: ReactNode }) {
  const slug = getActiveShopSlug();
  const [state, setState] = useState<ShopState>({
    shop: null,
    slug,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .getShop(ctrl.signal)
      .then((shop) => {
        applyBranding(shop);
        // Laad de per-shop marketing-tags (GA4/Ads/Pixel/Clarity) zodra de
        // shop-id bekend is. No-op als er niets is ingevuld in de admin.
        injectStorefrontTags(shop.id);
        setState({ shop, slug, loading: false, error: null });
      })
      .catch((err) => {
        if ((err as Error)?.name === 'AbortError') return;
        const msg =
          err instanceof ApiError && err.code === 'shop_not_found'
            ? `Onbekende shop "${slug}".`
            : 'Kon de shop niet laden.';
        setState({ shop: null, slug, loading: false, error: msg });
      });
    return () => ctrl.abort();
  }, [slug]);

  const value = useMemo(() => state, [state]);
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopState {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error('useShop must be used within ShopProvider');
  return ctx;
}
