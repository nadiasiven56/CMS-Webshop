import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Calendar, List, Search, Timer } from 'lucide-react';
import { listMovements } from '@/lib/api-with-fallback';
import { MovementsTable, type MovementRow } from '@/components/stock/MovementsTable';
import { MovementsTimeline } from '@/components/stock/MovementsTimeline';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { asApiError } from '@/lib/api';

export const Route = createFileRoute('/_app/movements')({
  component: MovementsPage,
});

interface MovementsResponse {
  items: MovementRow[];
  page: number;
  pageSize: number;
  total: number;
}

const REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Alle redenen' },
  { value: 'receive', label: 'Receive' },
  { value: 'damage', label: 'Damage' },
  { value: 'loss', label: 'Loss' },
  { value: 'audit', label: 'Audit' },
  { value: 'manual', label: 'Manual' },
  { value: 'adjust', label: 'Adjust' },
  { value: 'sale', label: 'Sale' },
  { value: 'return', label: 'Return' },
  { value: 'po_receive', label: 'PO receive' },
  { value: 'transfer', label: 'Transfer' },
];

type ViewMode = 'table' | 'timeline';

function MovementsPage() {
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      const v = window.localStorage.getItem('webshop-crm.movements.view');
      if (v === 'timeline' || v === 'table') return v;
    }
    return 'table';
  });
  const [reason, setReason] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('webshop-crm.movements.view', view);
    }
  }, [view]);

  const queryKey = ['movements', { reason, fromDate, toDate, page, pageSize }];

  const { data, isLoading, error, refetch, isFetching } = useQuery<MovementsResponse>({
    queryKey,
    queryFn: async () => {
      const res = await listMovements({
        page,
        pageSize,
        reason: reason || undefined,
        fromDate: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
        toDate: toDate ? new Date(`${toDate}T23:59:59`).toISOString() : undefined,
      });
      return res as MovementsResponse;
    },
    staleTime: 5_000,
  });

  const filteredItems = useMemo(() => {
    if (!data) return [];
    if (!itemSearch.trim()) return data.items;
    const q = itemSearch.trim().toLowerCase();
    return data.items.filter((m) => (m.itemSku ?? '').toLowerCase().includes(q));
  }, [data, itemSearch]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Movements</h1>
            <span className="count-badge">{data?.total ?? 0}</span>
          </div>
          <p className="page-subtitle">Read-only audit-trail van alle voorraadmutaties.</p>
        </div>
        <div className="segmented" aria-label="Weergave">
          <button
            type="button"
            data-active={view === 'table'}
            onClick={() => setView('table')}
          >
            <List size={13} /> Tabel
          </button>
          <button
            type="button"
            data-active={view === 'timeline'}
            onClick={() => setView('timeline')}
          >
            <Timer size={13} /> Tijdlijn
          </button>
        </div>
      </header>

      {/* Filter bar */}
      <div className="toolbar">
        <div className="search-input">
          <Search size={14} />
          <input
            type="text"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            placeholder="SKU bevat…"
          />
        </div>

        <select
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setPage(1);
          }}
          style={{ padding: '6px 10px', fontSize: 12.5 }}
        >
          {REASON_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <DateField
          label="Van"
          value={fromDate}
          onChange={(v) => {
            setFromDate(v);
            setPage(1);
          }}
        />
        <DateField
          label="Tot"
          value={toDate}
          onChange={(v) => {
            setToDate(v);
            setPage(1);
          }}
        />

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setReason('');
            setFromDate('');
            setToDate('');
            setItemSearch('');
            setPage(1);
          }}
        >
          Wissen
        </button>

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
        <div className="card" style={{ borderColor: 'var(--theme-danger)', marginBottom: 16 }}>
          <p className="error-text" style={{ margin: 0 }}>
            Fout: {asApiError(error).message}
          </p>
        </div>
      )}

      {isLoading ? (
        <SkeletonTableRows rows={8} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="Geen mutaties gevonden"
          description="Pas de filters aan of wis ze om alle activiteit te tonen."
        />
      ) : view === 'table' ? (
        <MovementsTable rows={filteredItems} loading={false} />
      ) : (
        <MovementsTimeline rows={filteredItems} />
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

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        fontSize: 11,
        color: 'var(--theme-muted)',
      }}
    >
      <span>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: '4px 8px', fontSize: 12.5, minWidth: 130 }}
      />
    </label>
  );
}
