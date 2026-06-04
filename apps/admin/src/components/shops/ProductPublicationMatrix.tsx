/**
 * ProductPublicationMatrix — per-shop product-publicatie.
 *
 * Toont ALLE catalogus-producten (uit `/api/products`) gemerged met de
 * shop-publicatie-rijen (`GET /api/shops/:id/products`):
 *   - published toggle  → PUT /api/shops/:id/products/:productId { published }
 *   - price_override     → idem { priceOverride: string|null }
 *   - position           → idem { position }
 *
 * Niet-gepubliceerde producten worden óók getoond zodat je ze kunt toevoegen.
 * Geld blijft string (Money) — geen number-conversie.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { toastBus } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { asApiError } from '@/lib/api';
import {
  useCatalogProducts,
  useShopProducts,
  useUpsertShopProduct,
} from './api';
import type { CatalogProduct, ShopProductDto } from './types';

interface MatrixRow {
  product: CatalogProduct;
  sp: ShopProductDto | null;
}

const MONEY_RE = /^-?\d+(\.\d{1,4})?$/;

export function ProductPublicationMatrix({ shopId, currency }: { shopId: string; currency: string }) {
  const catalog = useCatalogProducts();
  const shopProducts = useShopProducts(shopId, false);
  const upsert = useUpsertShopProduct(shopId);

  const [search, setSearch] = useState('');
  const [onlyPublished, setOnlyPublished] = useState(false);
  // Lokale draft van price-overrides per productId, zodat je kunt typen vóór save.
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [priceErr, setPriceErr] = useState<Record<string, boolean>>({});

  const spByProduct = useMemo(() => {
    const m = new Map<string, ShopProductDto>();
    for (const sp of shopProducts.data?.items ?? []) m.set(sp.productId, sp);
    return m;
  }, [shopProducts.data]);

  // Sync price-drafts wanneer server-data verandert (en geen open edit is).
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const sp of shopProducts.data?.items ?? []) {
      next[sp.productId] = sp.priceOverride ?? '';
    }
    setPriceDraft((prev) => ({ ...next, ...prev }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopProducts.data]);

  const rows: MatrixRow[] = useMemo(() => {
    const list = (catalog.data ?? []).map((product) => ({
      product,
      sp: spByProduct.get(product.id) ?? null,
    }));
    const term = search.trim().toLowerCase();
    return list
      .filter((r) => (onlyPublished ? r.sp?.published : true))
      .filter(
        (r) =>
          !term ||
          r.product.title.toLowerCase().includes(term) ||
          r.product.slug.toLowerCase().includes(term),
      )
      .sort((a, b) => {
        // gepubliceerd eerst (op position), dan rest alfabetisch
        const ap = a.sp?.published ? 0 : 1;
        const bp = b.sp?.published ? 0 : 1;
        if (ap !== bp) return ap - bp;
        if (ap === 0) return (a.sp?.position ?? 0) - (b.sp?.position ?? 0);
        return a.product.title.localeCompare(b.product.title);
      });
  }, [catalog.data, spByProduct, search, onlyPublished]);

  const publishedCount = (shopProducts.data?.items ?? []).filter((s) => s.published).length;

  function doUpsert(productId: string, patch: { published?: boolean; priceOverride?: string | null; position?: number }, successMsg?: string) {
    upsert.mutate(
      { productId, patch },
      {
        onSuccess: () => {
          if (successMsg) toastBus.push('success', successMsg);
        },
        onError: (err) => {
          const e = asApiError(err);
          toastBus.push('error', e.message || 'Opslaan mislukt');
        },
      },
    );
  }

  function togglePublished(row: MatrixRow) {
    const next = !row.sp?.published;
    doUpsert(
      row.product.id,
      { published: next },
      next ? `"${row.product.title}" gepubliceerd` : `"${row.product.title}" verborgen`,
    );
  }

  function commitPrice(row: MatrixRow) {
    const raw = (priceDraft[row.product.id] ?? '').trim();
    if (raw && !MONEY_RE.test(raw)) {
      setPriceErr((p) => ({ ...p, [row.product.id]: true }));
      return;
    }
    setPriceErr((p) => ({ ...p, [row.product.id]: false }));
    const current = row.sp?.priceOverride ?? '';
    if (raw === current) return; // niets gewijzigd
    doUpsert(row.product.id, { priceOverride: raw === '' ? null : raw }, 'Prijs-override opgeslagen');
  }

  function commitPosition(row: MatrixRow, value: string) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n) || n < 0) return;
    if (n === (row.sp?.position ?? 0)) return;
    doUpsert(row.product.id, { position: n });
  }

  const loading = catalog.isLoading || shopProducts.isLoading;
  const errored = catalog.isError || shopProducts.isError;

  return (
    <div className="card" style={{ padding: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          borderBottom: '1px solid var(--border-default)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14 }}>Product-publicatie</div>
        <span className="count-badge">{publishedCount} gepubliceerd</span>
        <div style={{ flex: 1 }} />
        <div className="search-input" style={{ maxWidth: 240 }}>
          <Search size={14} />
          <input
            aria-label="Zoek producten"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek product…"
          />
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--theme-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyPublished} onChange={(e) => setOnlyPublished(e.target.checked)} />
          Alleen gepubliceerd
        </label>
      </div>

      {errored ? (
        <div style={{ padding: 16 }}>
          <p className="error-text">Kon producten niet laden.</p>
        </div>
      ) : loading ? (
        <div style={{ padding: 16 }}>
          <Skeleton height={260} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 8 }}>
          <EmptyState
            icon={Search}
            title="Geen producten"
            description={
              (catalog.data ?? []).length === 0
                ? 'Er staan nog geen producten in de catalogus.'
                : 'Geen producten die aan de filters voldoen.'
            }
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>Live</th>
                <th>Product</th>
                <th style={{ width: 160 }}>Prijs-override ({currency})</th>
                <th style={{ width: 90 }}>Positie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const published = !!row.sp?.published;
                return (
                  <tr key={row.product.id}>
                    <td>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={published}
                        aria-label={published ? 'Verberg product' : 'Publiceer product'}
                        onClick={() => togglePublished(row)}
                        disabled={upsert.isPending}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          border: `1px solid ${published ? 'var(--theme-accent-border, var(--theme-accent))' : 'var(--border-default)'}`,
                          background: published ? 'var(--theme-accent)' : 'transparent',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        {published && <Check size={14} />}
                      </button>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong style={{ fontSize: 13 }}>{row.product.title}</strong>
                        <span className="muted" style={{ fontSize: 11.5 }}>/{row.product.slug}</span>
                      </div>
                    </td>
                    <td>
                      <input
                        value={priceDraft[row.product.id] ?? ''}
                        onChange={(e) => setPriceDraft((p) => ({ ...p, [row.product.id]: e.target.value }))}
                        onBlur={() => commitPrice(row)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        placeholder="standaard"
                        inputMode="decimal"
                        style={{
                          width: '100%',
                          padding: '5px 8px',
                          fontSize: 12.5,
                          borderColor: priceErr[row.product.id] ? 'var(--danger)' : undefined,
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        defaultValue={row.sp?.position ?? 0}
                        key={`${row.product.id}-${row.sp?.position ?? 0}`}
                        onBlur={(e) => commitPosition(row, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        style={{ width: '100%', padding: '5px 8px', fontSize: 12.5 }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
