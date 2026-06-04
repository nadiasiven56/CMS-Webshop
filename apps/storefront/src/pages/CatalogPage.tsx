import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { ProductCard } from '../components/ProductCard';
import {
  EmptyState,
  ErrorState,
  ProductGridSkeleton,
} from '../components/States';
import type { SortOption } from '../api/types';

const SORTS: { value: SortOption; label: string }[] = [
  { value: 'position', label: 'Aanbevolen' },
  { value: 'newest', label: 'Nieuwste' },
  { value: 'price_asc', label: 'Prijs ↑' },
  { value: 'price_desc', label: 'Prijs ↓' },
  { value: 'title', label: 'Naam (A-Z)' },
];

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL is de bron-van-waarheid voor search/sort (deelbaar + back-knop).
  const urlSearch = searchParams.get('q') ?? '';
  const urlSort = (searchParams.get('sort') as SortOption) ?? 'position';

  const [searchInput, setSearchInput] = useState(urlSearch);

  // debounce de zoek-input naar de URL
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchInput.trim()) next.set('q', searchInput.trim());
      else next.delete('q');
      // shop-query behouden
      setSearchParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const setSort = (sort: SortOption) => {
    const next = new URLSearchParams(searchParams);
    next.set('sort', sort);
    setSearchParams(next, { replace: true });
  };

  const effectiveSearch = urlSearch;
  const productsQ = useAsync(
    (signal) =>
      api.listProducts(
        {
          limit: 100,
          sort: urlSort,
          search: effectiveSearch || undefined,
        },
        signal,
      ),
    [effectiveSearch, urlSort],
  );

  const items = useMemo(() => productsQ.data?.items ?? [], [productsQ.data]);

  return (
    <div className="container">
      <div className="section__head" style={{ marginTop: 28 }}>
        <h1>Shop</h1>
        {productsQ.data && (
          <span className="product-card__vendor">
            {productsQ.data.total} producten
          </span>
        )}
      </div>

      <div className="toolbar">
        <input
          className="input search-field"
          type="search"
          placeholder="Zoek producten…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Zoeken"
        />
        <select
          className="select"
          value={urlSort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          aria-label="Sorteren"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {productsQ.loading ? (
        <ProductGridSkeleton count={12} />
      ) : productsQ.error ? (
        <ErrorState onRetry={productsQ.reload} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Geen producten gevonden"
          message={
            effectiveSearch
              ? `Niets voor "${effectiveSearch}". Probeer een andere zoekterm.`
              : 'Er zijn nog geen producten gepubliceerd.'
          }
        />
      ) : (
        <div className="product-grid" style={{ marginBottom: 48 }}>
          {items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
