import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  Layers,
  PackageX,
  Search,
  Wallet,
} from 'lucide-react';
import { listStock, DEMO_MODE } from '@/lib/api-with-fallback';
import { MOCK_STOCK_ROWS } from '@/lib/mock-data';
import { StockTable, type StockTableRow } from '@/components/stock/StockTable';
import { KpiCard } from '@/components/ui/KpiCard';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { asApiError } from '@/lib/api';

export const Route = createFileRoute('/_app/stock/')({
  component: StockPage,
});

interface StockOverviewResponse {
  items: StockTableRow[];
  page: number;
  pageSize: number;
  total: number;
}

type SortValue =
  | 'sku_asc'
  | 'sku_desc'
  | 'available_asc'
  | 'available_desc'
  | 'on_hand_asc'
  | 'on_hand_desc';

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(v);
}

function StockPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<SortValue>('available_asc');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Debounce search 250ms
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(handle);
  }, [search]);

  const queryKey = ['stock', { page, pageSize, sort, debouncedSearch, lowStockOnly }];

  const { data, isLoading, error, refetch, isFetching } = useQuery<StockOverviewResponse>({
    queryKey,
    queryFn: async () => {
      const res = await listStock({
        page,
        pageSize,
        sort,
        search: debouncedSearch.trim() || undefined,
        lowStockOnly,
      });
      return res as StockOverviewResponse;
    },
    staleTime: 5_000,
  });

  // KPIs over alle items (mock-data: simpel optellen)
  const kpis = useMemo(() => {
    // In demo gebruik volledige mock-set, anders tonen we wat we hebben
    const all = DEMO_MODE ? MOCK_STOCK_ROWS : data?.items ?? [];
    const totalSkus = all.length;
    const lowStock = all.filter((r: any) => r.lowStock).length;
    const outOfStock = all.filter((r: any) => r.availableTotal <= 0).length;
    const totalValue = all.reduce((sum: number, r: any) => {
      const cost = (r.costPrice ?? 100) as number;
      return sum + cost * r.onHandTotal;
    }, 0);
    return { totalSkus, lowStock, outOfStock, totalValue };
  }, [data]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Voorraad</h1>
            <span className="count-badge">{data?.total ?? 0}</span>
          </div>
          <p className="page-subtitle">Stock per locatie en handmatige adjustments.</p>
        </div>
      </header>

      {/* KPI strip */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <KpiCard
          label="Total SKU's"
          value={kpis.totalSkus}
          icon={Layers}
          size="sm"
        />
        <KpiCard
          label="Voorraad-waarde"
          value={formatCurrency(kpis.totalValue)}
          icon={Wallet}
          size="sm"
          hint="op cost-price"
        />
        <KpiCard
          label="Low stock"
          value={kpis.lowStock}
          icon={AlertTriangle}
          size="sm"
          hint={
            <button
              type="button"
              onClick={() => setLowStockOnly(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--theme-accent)',
                fontSize: 12,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Bekijk low-stock →
            </button>
          }
        />
        <KpiCard
          label="Out of stock"
          value={kpis.outOfStock}
          icon={PackageX}
          size="sm"
        />
      </section>

      {/* Filter bar */}
      <div className="toolbar">
        <div className="search-input">
          <Search size={14} />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Zoek op SKU of titel…"
          />
        </div>

        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as SortValue);
            setPage(1);
          }}
          style={{ padding: '6px 10px', fontSize: 12.5 }}
        >
          <option value="available_asc">Available ↑</option>
          <option value="available_desc">Available ↓</option>
          <option value="sku_asc">SKU ↑</option>
          <option value="sku_desc">SKU ↓</option>
          <option value="on_hand_asc">On hand ↑</option>
          <option value="on_hand_desc">On hand ↓</option>
        </select>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            cursor: 'pointer',
            color: lowStockOnly ? 'var(--theme-accent)' : 'var(--theme-muted)',
            padding: '4px 10px',
            borderRadius: 8,
            background: lowStockOnly ? 'var(--theme-accent-subtle)' : 'transparent',
            border: lowStockOnly ? '1px solid var(--theme-accent-border)' : '1px solid transparent',
          }}
        >
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => {
              setLowStockOnly(e.target.checked);
              setPage(1);
            }}
            style={{ width: 14, height: 14, padding: 0 }}
          />
          Alleen low-stock
        </label>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? 'Laden…' : 'Vernieuwen'}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="card"
          style={{ borderColor: 'var(--theme-danger)', marginBottom: 16 }}
        >
          <p className="error-text" style={{ margin: 0 }}>
            Fout: {asApiError(error).message}
          </p>
        </div>
      )}

      {isLoading ? (
        <SkeletonTableRows rows={8} />
      ) : (data?.items ?? []).length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Geen voorraad-items"
          description={
            debouncedSearch || lowStockOnly
              ? 'Probeer een andere zoekterm of zet filters uit.'
              : 'Voorraad-items verschijnen hier zodra varianten worden aangemaakt.'
          }
        />
      ) : (
        <StockTable rows={data?.items ?? []} loading={false} />
      )}

      {/* Pagination */}
      {data && data.total > pageSize && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
            fontSize: 13,
          }}
        >
          <span className="muted">
            Pagina {page} van {totalPages}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Vorige
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Volgende
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
