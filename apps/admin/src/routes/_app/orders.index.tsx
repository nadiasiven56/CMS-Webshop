/**
 * /orders — orders-lijst op de ECHTE API (shop-scoped).
 *
 * Vervangt de oude mock-only preview. Filters: status / financial / fulfillment /
 * channel / search + paginate. Status-pills via components/orders/Pills.
 * Klik-rij → /orders/$id (id = UUID). Handmatige order via create-drawer.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, ShoppingCart, Store } from 'lucide-react';
import {
  ChannelPill,
  OrderStatusPill,
  FinancialStatusPill,
  FulfillmentStatusPill,
} from '@/components/orders/Pills';
import { ShopPill } from '@/components/orders/ShopPill';
import { CreateOrderDrawer } from '@/components/orders/CreateOrderDrawer';
import { useOrderList, type OrderListFilters } from '@/components/orders/api';
import { money } from '@/components/orders/money';
import { useActiveShop } from '@/lib/shop-context';
import { formatDateTime } from '@/lib/format';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTableRows } from '@/components/ui/Skeleton';

export const Route = createFileRoute('/_app/orders/')({
  component: OrdersPage,
});

const PAGE_SIZE = 20;

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Alle' },
  { value: 'pending', label: 'Open' },
  { value: 'paid', label: 'Betaald' },
  { value: 'fulfilled', label: 'Verwerkt' },
  { value: 'shipped', label: 'Verzonden' },
  { value: 'delivered', label: 'Bezorgd' },
  { value: 'cancelled', label: 'Geannuleerd' },
];

const CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Alle' },
  { value: 'web', label: 'Webshop' },
  { value: 'bol', label: 'Bol.com' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'gmc', label: 'Google' },
];

/** Sentinel-waarde voor de shop-selector = consolideer alle shops. */
const ALL_SHOPS = '__all__';

function OrdersPage() {
  const navigate = useNavigate();
  const { activeShopId, shops } = useActiveShop();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  // Shop-scope: activeShopId (default) of ALL_SHOPS = alle-shops-inbox.
  const [shopFilter, setShopFilter] = useState<string>(ALL_SHOPS);
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Default-scope = de actieve shop zodra die bekend is (eenmalig, niet
  // overschrijven nadat de gebruiker bewust 'Alle shops' of een shop koos).
  const didInitShop = useRef(false);
  useEffect(() => {
    if (didInitShop.current) return;
    if (activeShopId) {
      setShopFilter(activeShopId);
      didInitShop.current = true;
    }
  }, [activeShopId]);

  const allShops = shopFilter === ALL_SHOPS;
  // Effectieve shop-id voor de query: in all-shops-modus null (→ shop_id weg).
  const scopedShopId = allShops ? null : shopFilter || activeShopId;
  const shopNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of shops) m.set(s.id, s.name);
    return m;
  }, [shops]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset paging bij filterwijziging of shop-scope-wissel
  useEffect(() => {
    setOffset(0);
  }, [status, channel, shopFilter]);

  const filters: OrderListFilters = useMemo(
    () => ({
      status: status || undefined,
      channel: channel || undefined,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [status, channel, search, offset],
  );

  const query = useOrderList(scopedShopId, filters, allShops);

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasFilters = !!status || !!channel || !!search;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Orders</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">
            {allShops
              ? 'Alle orders uit álle shops en kanalen — één gezamenlijke inbox.'
              : 'Orders van de gekozen shop — eigen webshop en marktplaats-kanalen.'}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setCreateOpen(true)}
          disabled={!activeShopId}
        >
          <Plus size={15} strokeWidth={2.2} />
          Handmatige order
        </button>
      </div>

      {/* Toolbar: shop-scope + search + status-tabs */}
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <label
          aria-label="Shop-scope"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Store size={14} style={{ color: 'var(--theme-muted)', flexShrink: 0 }} />
          <select
            value={shopFilter}
            onChange={(e) => setShopFilter(e.target.value)}
            style={{ minWidth: 150 }}
          >
            <option value={ALL_SHOPS}>Alle shops</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="search-input">
          <Search size={14} />
          <input
            ref={searchRef}
            aria-label="Zoek orders"
            placeholder="Zoek op order-nr of e-mail…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="segmented" role="tablist" aria-label="Status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              data-active={status === t.value}
              onClick={() => setStatus(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Kanaal-filter */}
      <div className="toolbar" style={{ marginBottom: 16, gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--theme-muted)', marginRight: 4 }}>Kanaal:</span>
        {CHANNEL_OPTIONS.map((c) => (
          <button
            key={c.value || '__all__'}
            type="button"
            className="badge"
            aria-pressed={channel === c.value}
            onClick={() => setChannel(c.value)}
            style={{
              cursor: 'pointer',
              border: 'none',
              background:
                channel === c.value ? 'var(--theme-accent-subtle)' : 'var(--theme-card2)',
              color: channel === c.value ? 'var(--theme-accent)' : 'var(--theme-text)',
            }}
          >
            {c.label}
          </button>
        ))}
        {hasFilters && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setStatus('');
              setChannel('');
              setSearchInput('');
              setSearch('');
            }}
          >
            Wis filters
          </button>
        )}
      </div>

      {/* Content */}
      {!allShops && !activeShopId ? (
        <EmptyState icon={ShoppingCart} title="Geen shop geselecteerd" description="Kies een shop in de balk bovenaan of zet de scope op “Alle shops”." />
      ) : query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">Kon orders niet laden. Controleer of de backend draait en probeer pagina-refresh.</p>
        </div>
      ) : query.isLoading ? (
        <SkeletonTableRows rows={8} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Search}
          title={hasFilters ? 'Geen orders gevonden' : 'Nog geen orders'}
          description={
            hasFilters
              ? 'Pas je zoekopdracht of filters aan om resultaten te zien.'
              : allShops
                ? 'Er zijn nog geen orders in welke shop dan ook. Maak een handmatige order aan of wacht op storefront-checkouts.'
                : 'Er zijn nog geen orders voor deze shop. Maak een handmatige order aan of wacht op storefront-checkouts.'
          }
          action={
            !hasFilters ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> Handmatige order
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="table-wrap">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  {allShops && <th>Shop</th>}
                  <th>Datum</th>
                  <th>Klant</th>
                  <th>Kanaal</th>
                  <th style={{ textAlign: 'right' }}>Items</th>
                  <th style={{ textAlign: 'right' }}>Totaal</th>
                  <th>Status</th>
                  <th>Betaling</th>
                  <th>Fulfilment</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => void navigate({ to: '/orders/$id', params: { id: o.id } })}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <span
                        className="mono"
                        style={{ color: 'var(--theme-accent)', fontWeight: 600 }}
                      >
                        {o.orderNumber}
                      </span>
                    </td>
                    {allShops && (
                      <td>
                        <ShopPill shopId={o.shopId} name={shopNameById.get(o.shopId)} />
                      </td>
                    )}
                    <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>
                      {formatDateTime(o.createdAt)}
                    </td>
                    <td>{o.customerName || o.email || <span className="muted">—</span>}</td>
                    <td><ChannelPill slug={o.channel} compact /></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{o.itemCount}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {money(o.grandTotal)}
                    </td>
                    <td><OrderStatusPill status={o.status} /></td>
                    <td><FinancialStatusPill status={o.financialStatus} /></td>
                    <td><FulfillmentStatusPill status={o.fulfillmentStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Paginatie */}
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Vorige
            </button>
            <span className="muted" style={{ fontSize: 13 }}>Pagina {page} / {totalPages}</span>
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

      <CreateOrderDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          void navigate({ to: '/orders/$id', params: { id } });
        }}
      />
    </div>
  );
}
