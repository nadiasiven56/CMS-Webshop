/**
 * /shops (index) — shops-beheer (multi-shop tenant-overzicht).
 *
 * Praat met de echte `/api/shops`. NIET shop-scoped: dit beheert de shops zélf.
 * Index-route onder de `shops`-layout (shops.tsx = <Outlet/>), zodat /shops de
 * lijst toont en /shops/:id de detail-pagina (anders rendert TanStack de parent).
 * Features:
 *   - View-toggle: Cards (default) | Tabel
 *   - Status-tabs (alle/active/draft/paused) met counts
 *   - Search (debounced) op naam/slug/domein
 *   - "Nieuwe shop" via ShopDrawer (slug/name/domain/locale/currency/branding/btw)
 *   - Loading (Skeleton), empty (EmptyState), error-card
 *   - Klik op een kaart/rij → detail-page (/shops/:id)
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Grid3x3, Globe, List, Plus, Search, Store } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ClickableRow } from '@/components/ui/ClickableRow';
import { toastBus } from '@/components/ui/Toast';
import { asApiError } from '@/lib/api';
import { ShopStatusBadge } from '@/components/shops/ShopStatusBadge';
import { ShopDrawer, valuesToPayload } from '@/components/shops/ShopDrawer';
import { useShopList, useCreateShop } from '@/components/shops/api';
import type { ShopDto } from '@/components/shops/types';

export const Route = createFileRoute('/_app/shops/')({
  component: ShopsPage,
});

const PAGE_SIZE = 50;
const STATUS_TABS = [
  { value: '', label: 'Alle' },
  { value: 'active', label: 'Actief' },
  { value: 'draft', label: 'Concept' },
  { value: 'paused', label: 'Gepauzeerd' },
];

type ViewMode = 'cards' | 'table';

function ShopsPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('webshop-crm.shops.view');
      if (saved === 'cards' || saved === 'table') return saved;
    }
    return 'cards';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('webshop-crm.shops.view', view);
    }
  }, [view]);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: 0,
      status: status || undefined,
      search: searchDebounced || undefined,
    }),
    [status, searchDebounced],
  );

  const query = useShopList(params);
  const createShop = useCreateShop();

  // Counts: aparte ongefilterde query voor de tab-tellers.
  const allQuery = useShopList({ limit: 100, offset: 0 });
  const counts = useMemo(() => {
    const items = allQuery.data?.items ?? [];
    return {
      total: items.length,
      active: items.filter((s) => s.status === 'active').length,
      draft: items.filter((s) => s.status === 'draft').length,
      paused: items.filter((s) => s.status === 'paused').length,
    };
  }, [allQuery.data]);

  const items = query.data?.items ?? [];

  function handleCreate(payload: ReturnType<typeof valuesToPayload>) {
    createShop.mutate(payload, {
      onSuccess: (shop) => {
        toastBus.push('success', `Shop "${shop.name}" aangemaakt`);
        setCreateOpen(false);
        void navigate({ to: '/shops/$id', params: { id: shop.id } });
      },
      onError: (err) => {
        const e = asApiError(err);
        const msg =
          e.code === 'slug_taken'
            ? 'Die slug is al in gebruik'
            : e.code === 'domain_taken'
              ? 'Dat domein is al in gebruik'
              : e.message || 'Aanmaken mislukt';
        toastBus.push('error', msg);
      },
    });
  }

  function countFor(value: string) {
    if (value === '') return counts.total;
    if (value === 'active') return counts.active;
    if (value === 'draft') return counts.draft;
    return counts.paused;
  }

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Shops</h1>
            <span className="count-badge">{counts.total}</span>
          </div>
          <p className="page-subtitle">Beheer je winkels, domeinen, branding en BTW-instellingen.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-icon-leading"
          onClick={() => setCreateOpen(true)}
        >
          <Plus size={14} />
          Nieuwe shop
        </button>
      </header>

      <div className="toolbar">
        <div className="search-input">
          <Search size={14} />
          <input
            aria-label="Zoek shops"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Zoek op naam, slug of domein…"
          />
        </div>

        <div className="segmented" role="tablist" aria-label="Status">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              data-active={status === tab.value}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
              <span className="seg-count">{countFor(tab.value)}</span>
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <div className="segmented" aria-label="Weergave">
          <button type="button" data-active={view === 'cards'} onClick={() => setView('cards')} title="Cards">
            <Grid3x3 size={13} />
          </button>
          <button type="button" data-active={view === 'table'} onClick={() => setView('table')} title="Tabel">
            <List size={13} />
          </button>
        </div>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">Kon shops niet laden. Probeer pagina-refresh.</p>
        </div>
      ) : query.isLoading ? (
        view === 'cards' ? (
          <div
            className="shops-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={140} />
            ))}
          </div>
        ) : (
          <Skeleton height={320} />
        )
      ) : items.length === 0 ? (
        <EmptyState
          icon={searchDebounced || status ? Search : Store}
          title={searchDebounced || status ? 'Geen shops gevonden' : 'Nog geen shops'}
          description={
            searchDebounced || status
              ? 'Probeer een andere zoekterm of pas het statusfilter aan.'
              : 'Maak je eerste shop aan om het platform te starten.'
          }
          action={
            !searchDebounced && !status ? (
              <button type="button" className="btn btn-primary btn-icon-leading" onClick={() => setCreateOpen(true)}>
                <Plus size={14} />
                Nieuwe shop
              </button>
            ) : undefined
          }
        />
      ) : view === 'cards' ? (
        <ShopCards items={items} onOpen={(id) => navigate({ to: '/shops/$id', params: { id } })} />
      ) : (
        <ShopTable items={items} onOpen={(id) => navigate({ to: '/shops/$id', params: { id } })} />
      )}

      <ShopDrawer
        open={createOpen}
        mode="create"
        saving={createShop.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}

function brandingDot(shop: ShopDto): string {
  const c = shop.branding?.primaryColor;
  return typeof c === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)
    ? c
    : 'var(--theme-accent)';
}

function ShopCards({ items, onOpen }: { items: ShopDto[]; onOpen: (id: string) => void }) {
  return (
    <div className="shops-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {items.map((shop) => (
        <button
          key={shop.id}
          type="button"
          className="card"
          onClick={() => onOpen(shop.id)}
          style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span
                aria-hidden
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  background: brandingDot(shop),
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                <Store size={16} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shop.name}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>/{shop.slug}</div>
              </div>
            </div>
            <ShopStatusBadge status={shop.status} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--theme-muted)' }}>
            <Globe size={13} />
            {shop.domain ? shop.domain : <span className="muted">Geen domein</span>}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="pill">{shop.currency}</span>
            <span className="pill">{shop.locale}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function ShopTable({ items, onOpen }: { items: ShopDto[]; onOpen: (id: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Naam</th>
            <th>Slug</th>
            <th>Domein</th>
            <th>Valuta</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((shop) => (
            <ClickableRow key={shop.id} onActivate={() => onOpen(shop.id)} ariaLabel={`Open shop ${shop.name}`}>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: brandingDot(shop), display: 'inline-block' }} />
                  <strong>{shop.name}</strong>
                </span>
              </td>
              <td className="muted">/{shop.slug}</td>
              <td>{shop.domain ?? <span className="muted">—</span>}</td>
              <td>{shop.currency}</td>
              <td><ShopStatusBadge status={shop.status} /></td>
            </ClickableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
