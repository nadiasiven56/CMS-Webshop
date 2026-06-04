/**
 * /channels/matrix — product×kanaal publish-matrix op de ECHTE API.
 *
 * Bron: per kanaal `GET /api/channels/:id/products` (channel_products). De
 * matrix-rijen zijn de UNIE van alle gelinkte variant-listings over de kanalen;
 * elke kolom is een kanaal. Een cel = of die variant `enabled` is op dat kanaal.
 * Toggle → `PUT /api/channels/:id/products/:variantId` (useToggleChannelProduct).
 *
 * Let op: een marketplace die niet verbonden is geeft bij toggle een echte 409
 * (channel_not_connected) terug; dat tonen we als toast i.p.v. te faken.
 *
 * Look/UX 1-op-1 behouden t.o.v. de oude mock-matrix (zelfde toggle-cellen,
 * zoek, filter, kolomkoppen).
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, Search, Check, X, Package,
} from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { api, asApiError } from '@/lib/api';
import {
  useChannels,
  useToggleChannelProduct,
  channelTypeMeta,
  CHANNELS_QUERY_KEYS,
  type ChannelDetailDto,
  type ChannelProductsResponse,
} from '@/components/channels/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/channels/matrix')({
  component: MatrixPage,
});

interface MatrixRow {
  variantId: string;
  productId: string;
  title: string;
  sku: string | null;
  /** channelId → cel-listing (of undefined = niet gelinkt). */
  cells: Record<string, { enabled: boolean; status: string } | undefined>;
}

function MatrixPage() {
  const channelsQuery = useChannels();
  const channels = useMemo<ChannelDetailDto[]>(
    () => channelsQuery.data?.items ?? [],
    [channelsQuery.data],
  );

  // Eén query per kanaal voor zijn channel_products.
  const productQueries = useQueries({
    queries: channels.map((c) => ({
      queryKey: CHANNELS_QUERY_KEYS.products(c.id, false),
      queryFn: async (): Promise<ChannelProductsResponse> => {
        const res = await api.get<ChannelProductsResponse>(`/channels/${c.id}/products`);
        return res.data;
      },
      enabled: channels.length > 0,
    })),
  });

  const toggle = useToggleChannelProduct();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [channelFilter, setChannelFilter] = useState<string>('all');

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const productsLoading = productQueries.some((q) => q.isLoading);
  const productsError = productQueries.some((q) => q.isError);

  // Bouw de matrix-rijen uit alle channel_products (unie op variantId).
  const rows = useMemo<MatrixRow[]>(() => {
    const byVariant = new Map<string, MatrixRow>();
    channels.forEach((c, idx) => {
      const data = productQueries[idx]?.data;
      if (!data) return;
      for (const cp of data.items) {
        if (!cp.variantId) continue;
        let row = byVariant.get(cp.variantId);
        if (!row) {
          row = {
            variantId: cp.variantId,
            productId: cp.productId,
            title: cp.product?.title ?? cp.productId,
            sku: cp.product?.sku ?? null,
            cells: {},
          };
          byVariant.set(cp.variantId, row);
        }
        row.cells[c.id] = { enabled: cp.enabled, status: cp.status };
      }
    });
    return Array.from(byVariant.values()).sort((a, b) =>
      a.title.localeCompare(b.title, 'nl'),
    );
  }, [channels, productQueries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (q) {
        const hay = `${row.title} ${row.sku ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (onlyEnabled) {
        const anyEnabled = Object.values(row.cells).some((c) => c?.enabled);
        if (!anyEnabled) return false;
      }
      if (channelFilter !== 'all') {
        if (!row.cells[channelFilter]?.enabled) return false;
      }
      return true;
    });
  }, [rows, search, onlyEnabled, channelFilter]);

  async function onToggleCell(row: MatrixRow, channel: ChannelDetailDto) {
    const cell = row.cells[channel.id];
    const willEnable = !(cell?.enabled ?? false);
    try {
      await toggle.mutateAsync({
        channelId: channel.id,
        variantId: row.variantId,
        enabled: willEnable,
      });
      if (willEnable) {
        toast.success(`${row.title.slice(0, 30)} live op ${channel.name}`);
      }
    } catch (err) {
      const e2 = asApiError(err);
      if (e2.code === 'channel_not_connected') {
        toast.error(`${channel.name} is niet verbonden — configureer credentials eerst.`);
      } else {
        toast.error(`Wijziging mislukt: ${e2.message}`);
      }
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <Link to="/channels" className="btn btn-ghost btn-sm" style={{ paddingLeft: 6 }}>
          <ChevronLeft size={14} />
          Terug naar kanalen
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Per-product per-kanaal</h1>
          <p className="page-subtitle">
            Toggle welke producten waar live staan. Gebaseerd op de echte channel-listings.
          </p>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div className="search-input">
          <Search size={14} />
          <input
            placeholder="Zoek product…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--theme-muted)' }}>
          <input
            type="checkbox"
            checked={onlyEnabled}
            onChange={(e) => setOnlyEnabled(e.target.checked)}
            style={{ width: 'auto', padding: 0 }}
          />
          Alleen live
        </label>
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          style={{ padding: '6px 10px' }}
        >
          <option value="all">Alle kanalen</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {channelsQuery.isError || productsError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">
            Kon de matrix niet laden. Controleer of de backend draait en probeer pagina-refresh.
          </p>
        </div>
      ) : channelsQuery.isLoading || productsLoading ? (
        <SkeletonTableRows rows={8} />
      ) : channels.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Geen kanalen"
          description="Voeg eerst een verkoop-kanaal toe om producten per kanaal te beheren."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={rows.length === 0 ? 'Geen gelinkte producten' : 'Geen producten gevonden'}
          description={
            rows.length === 0
              ? 'Er zijn nog geen producten gepubliceerd op een kanaal. Sync een kanaal of publiceer producten om ze hier te zien.'
              : 'Pas je zoekopdracht of filters aan om resultaten te zien.'
          }
        />
      ) : (
        <div className="table-wrap">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ minWidth: 280 }}>Product</th>
                  {channels.map((c) => {
                    const meta = channelTypeMeta(c.type);
                    return (
                      <th key={c.id} style={{ textAlign: 'center', minWidth: 110 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          <span
                            style={{
                              display: 'inline-grid', placeItems: 'center',
                              width: 22, height: 22, borderRadius: 5,
                              background: meta.accent, color: '#fff',
                              fontSize: 11, fontWeight: 700,
                            }}
                          >
                            {meta.letter}
                          </span>
                          <span style={{ fontSize: 10.5 }}>{c.name.split(' ')[0]}</span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.variantId}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 6, overflow: 'hidden',
                          background: 'var(--surface-1)', border: '1px solid var(--border-subtle)',
                          flexShrink: 0, display: 'grid', placeItems: 'center', color: 'var(--text-faint)',
                        }}>
                          <Package size={14} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.title}
                          </div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--theme-muted)' }}>
                            {row.sku ?? '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    {channels.map((c) => {
                      const cell = row.cells[c.id];
                      return (
                        <td key={c.id} style={{ textAlign: 'center' }}>
                          <ChannelToggle
                            enabled={cell?.enabled ?? false}
                            disabled={toggle.isPending}
                            onToggle={() => void onToggleCell(row, c)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelToggle({
  enabled, disabled, onToggle,
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  if (!enabled) {
    return (
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        title="Niet actief — klik om in te schakelen"
        style={{
          width: 28, height: 28, borderRadius: 7,
          background: 'var(--surface-3)',
          border: '1px solid var(--border-default)',
          color: 'var(--text-faint)',
          display: 'inline-grid', placeItems: 'center',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <X size={13} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title="Live — klik om uit te schakelen"
      style={{
        width: 28, height: 28, borderRadius: 7,
        background: 'var(--success-soft)',
        border: '1px solid var(--success-border)',
        color: 'var(--success)',
        display: 'inline-grid', placeItems: 'center',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Check size={14} strokeWidth={2.4} />
    </button>
  );
}
