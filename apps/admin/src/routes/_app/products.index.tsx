/**
 * /products — productlijst (gepoliste design-pass).
 *
 * Features:
 *   - View-toggle: Cards (default) | Tabel
 *   - Status-tabs met counts (alle/draft/active/archived)
 *   - Search met ⌘K-hint
 *   - Sort-dropdown
 *   - Empty-state als geen matches
 *   - Skeleton tijdens loading
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownAZ,
  Grid3x3,
  List,
  Package,
  Plus,
  Search,
  PackageOpen,
} from 'lucide-react';
import { ProductTable } from '@/components/product/ProductTable';
import { ProductGrid } from '@/components/product/ProductGrid';
import { useProductList } from '@/components/product/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

export const Route = createFileRoute('/_app/products/')({
  component: ProductsPage,
});

const PAGE_SIZE = 20;
const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Alle' },
  { value: 'active', label: 'Actief' },
  { value: 'draft', label: 'Concept' },
  { value: 'archived', label: 'Archief' },
];

type ViewMode = 'cards' | 'table';

function ProductsPage() {
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [status, setStatus] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('webshop-crm.products.view');
      if (saved === 'cards' || saved === 'table') return saved;
    }
    return 'cards';
  });
  const [sort, setSort] = useState<'updated_desc' | 'title_asc' | 'price_asc' | 'price_desc'>(
    'updated_desc',
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('webshop-crm.products.view', view);
    }
  }, [view]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchDebounced(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset offset when filter changes
  useEffect(() => {
    setOffset(0);
  }, [status]);

  const params = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset,
      status: status || undefined,
      search: searchDebounced || undefined,
    }),
    [offset, status, searchDebounced],
  );

  const query = useProductList(params);

  // Counts per status — voor V1: query "all" zonder filter
  const allQuery = useProductList({ limit: 100, offset: 0 });
  const counts = useMemo(() => {
    const items = allQuery.data?.items ?? [];
    return {
      total: items.length,
      active: items.filter((p) => p.status === 'active').length,
      draft: items.filter((p) => p.status === 'draft').length,
      archived: items.filter((p) => p.status === 'archived').length,
    };
  }, [allQuery.data]);

  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Optionally sort items client-side (mock-data layer doesn't support price-sort)
  const sortedItems = useMemo(() => {
    const list = [...items];
    if (sort === 'title_asc') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'price_asc' || sort === 'price_desc') {
      list.sort((a, b) => {
        const ap = (a as any).pricePrimary ?? 0;
        const bp = (b as any).pricePrimary ?? 0;
        return sort === 'price_asc' ? ap - bp : bp - ap;
      });
    } else {
      // updated_desc default
      list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }
    return list;
  }, [items, sort]);

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Producten</h1>
            <span className="count-badge">{counts.total}</span>
          </div>
          <p className="page-subtitle">Beheer catalogus, varianten en foto's.</p>
        </div>
        <Link to="/products/new" className="btn btn-primary btn-icon-leading">
          <Plus size={14} />
          Nieuw product
        </Link>
      </header>

      <div className="toolbar">
        <div className="search-input">
          <Search size={14} />
          <input
            aria-label="Zoek producten"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Zoek op titel, vendor, SKU…"
          />
          <kbd>Ctrl K</kbd>
        </div>

        <div className="segmented" role="tablist" aria-label="Status">
          {STATUS_TABS.map((tab) => {
            const cnt =
              tab.value === ''
                ? counts.total
                : tab.value === 'active'
                  ? counts.active
                  : tab.value === 'draft'
                    ? counts.draft
                    : counts.archived;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                data-active={status === tab.value}
                onClick={() => setStatus(tab.value)}
              >
                {tab.label}
                <span className="seg-count">{cnt}</span>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <select
          aria-label="Sortering"
          value={sort}
          onChange={(e) => setSort(e.target.value as any)}
          style={{ padding: '6px 10px', fontSize: 12.5 }}
        >
          <option value="updated_desc">Recent bijgewerkt</option>
          <option value="title_asc">Titel A-Z</option>
          <option value="price_asc">Prijs ↑</option>
          <option value="price_desc">Prijs ↓</option>
        </select>

        <div className="segmented" aria-label="Weergave">
          <button
            type="button"
            data-active={view === 'cards'}
            onClick={() => setView('cards')}
            title="Cards"
          >
            <Grid3x3 size={13} />
          </button>
          <button
            type="button"
            data-active={view === 'table'}
            onClick={() => setView('table')}
            title="Tabel"
          >
            <List size={13} />
          </button>
        </div>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">Kon producten niet laden. Probeer pagina-refresh.</p>
        </div>
      ) : query.isLoading ? (
        view === 'cards' ? (
          <div className="product-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} height={250} />
            ))}
          </div>
        ) : (
          <Skeleton height={400} />
        )
      ) : items.length === 0 ? (
        <EmptyState
          icon={searchDebounced || status ? Search : PackageOpen}
          title={
            searchDebounced || status
              ? 'Geen producten gevonden'
              : 'Nog geen producten'
          }
          description={
            searchDebounced || status
              ? 'Probeer een andere zoekterm of pas filters aan.'
              : "Voeg je eerste product toe om de catalogus op te bouwen."
          }
          action={
            !searchDebounced && !status ? (
              <Link to="/products/new" className="btn btn-primary btn-icon-leading">
                <Plus size={14} />
                Nieuw product
              </Link>
            ) : undefined
          }
        />
      ) : view === 'cards' ? (
        <ProductGrid items={sortedItems} />
      ) : (
        <ProductTable items={sortedItems} />
      )}

      {total > PAGE_SIZE && !query.isLoading && (
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span className="muted" style={{ fontSize: 13 }}>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} van {total}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Vorige
            </button>
            <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>
              Pagina {page} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Volgende
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
