/**
 * /analytics (index) — "Statistieken": intern BI-dashboard op de ECHTE
 * analytics-API (`GET /api/analytics/*`).
 *
 * Een filter-bar bovenaan (shop, kanaal, datum-bereik, interval) stuurt
 * shop_id/channel/from/to/interval als query-params mee; een filter-wissel
 * herquerient alle panelen. "Alle shops" = shop_id weglaten.
 *
 * Charts hergebruiken EXACT de dashboard-aanpak: pure-SVG `AreaChart` +
 * `HBarChart` uit `@/components/ui/Sparkline` (geen chart-lib — het dashboard
 * hand-rolt SVG, dus dat doen wij ook). Geld komt als STRING uit de API en wordt
 * via parseMoney + Intl gerenderd.
 *
 * NB: INDEX-route van het analytics-layout (analytics.tsx, pure <Outlet/>).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import {
  BarChart3,
  Store,
  RefreshCw,
  TrendingUp,
  CircleDollarSign,
  ShoppingBag,
  Receipt,
  Boxes,
  Undo2,
  UserPlus,
  Package,
  Layers,
  AlertTriangle,
  Users,
} from 'lucide-react';
import { useActiveShop } from '@/lib/shop-context';
import {
  useSalesOverTime,
  useTopProducts,
  useAnalyticsKpis,
  useChannelBreakdown,
  useShopBreakdown,
  useLowStock,
  useTopCustomers,
  parseMoney,
  type AnalyticsFilters,
  type AnalyticsInterval,
} from '@/components/analytics/api';
import { KpiCard } from '@/components/ui/KpiCard';
import { AreaChart, HBarChart } from '@/components/ui/Sparkline';
import { Skeleton, SkeletonTableRows } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatNumber } from '@/lib/format';

export const Route = createFileRoute('/_app/analytics/')({
  component: AnalyticsPage,
});

/** Sentinel voor "Alle shops" (shop_id wordt dan weggelaten). */
const ALL_SHOPS = '__all__';

const CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Alle kanalen' },
  { value: 'web', label: 'Webshop' },
  { value: 'bol', label: 'Bol.com' },
  { value: 'amazon', label: 'Amazon' },
];

const INTERVALS: Array<{ value: AnalyticsInterval; label: string }> = [
  { value: 'day', label: 'Dag' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Maand' },
];

/** Datum-presets relatief aan vandaag → from (YYYY-MM-DD). to = vandaag. */
const RANGE_PRESETS: Array<{ value: string; label: string; days: number }> = [
  { value: '7', label: 'Laatste 7 dagen', days: 7 },
  { value: '30', label: 'Laatste 30 dagen', days: 30 },
  { value: '90', label: 'Laatste 90 dagen', days: 90 },
  { value: '365', label: 'Laatste 12 maanden', days: 365 },
];

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const EUR = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const EUR_COMPACT = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/** Money-STRING → '€ 1.234,56'. */
function money(value: string): string {
  return EUR.format(parseMoney(value));
}
function moneyNum(value: number): string {
  return EUR_COMPACT.format(value);
}
/** Aandeel (0..1) → '12,3%'. */
function pct(share: number): string {
  return new Intl.NumberFormat('nl-NL', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(share);
}

function AnalyticsPage() {
  const { shops, activeShopId } = useActiveShop();

  const [shopFilter, setShopFilter] = useState<string>(activeShopId ?? ALL_SHOPS);
  const [channel, setChannel] = useState('');
  const [rangePreset, setRangePreset] = useState('30');
  const [interval, setInterval] = useState<AnalyticsInterval>('day');

  const effectiveShop =
    shopFilter === ALL_SHOPS ? ALL_SHOPS : shopFilter || activeShopId || ALL_SHOPS;

  const range = useMemo(() => {
    const preset = RANGE_PRESETS.find((p) => p.value === rangePreset) ?? RANGE_PRESETS[1]!;
    const to = new Date();
    const from = new Date(to.getTime() - (preset.days - 1) * 24 * 3600 * 1000);
    return { from: ymd(from), to: ymd(to) };
  }, [rangePreset]);

  const filters: AnalyticsFilters = useMemo(
    () => ({
      shopId: effectiveShop === ALL_SHOPS ? null : effectiveShop,
      channel: channel || undefined,
      from: range.from,
      to: range.to,
      interval,
    }),
    [effectiveShop, channel, range, interval],
  );

  const kpis = useAnalyticsKpis(filters);
  const sales = useSalesOverTime(filters);
  const topProducts = useTopProducts(filters, 10);
  const channelBreakdown = useChannelBreakdown(filters);
  const shopBreakdown = useShopBreakdown(filters);
  const lowStock = useLowStock(filters, 5);
  const topCustomers = useTopCustomers(filters, 10);

  const anyFetching =
    kpis.isFetching ||
    sales.isFetching ||
    topProducts.isFetching ||
    channelBreakdown.isFetching ||
    shopBreakdown.isFetching ||
    lowStock.isFetching ||
    topCustomers.isFetching;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Statistieken</h1>
          </div>
          <p className="page-subtitle">
            Business-intelligence over je orders, producten en klanten — omzet,
            best-sellers, kanaal-verdeling en voorraad.
          </p>
        </div>
      </div>

      {/* ── Filter-bar: shop + kanaal + bereik + interval ── */}
      <div
        className="toolbar"
        style={{ marginBottom: 20, gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Store size={14} style={{ color: 'var(--theme-muted)' }} />
          <select
            aria-label="Shop-filter"
            value={effectiveShop}
            onChange={(e) => setShopFilter(e.target.value)}
          >
            <option value={ALL_SHOPS}>Alle shops</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <select
          aria-label="Kanaal-filter"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          {CHANNEL_OPTIONS.map((c) => (
            <option key={c.value || 'all'} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Datum-bereik"
          value={rangePreset}
          onChange={(e) => setRangePreset(e.target.value)}
        >
          {RANGE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        <div className="segmented" role="tablist" aria-label="Interval">
          {INTERVALS.map((iv) => (
            <button
              key={iv.value}
              type="button"
              role="tab"
              data-active={interval === iv.value}
              onClick={() => setInterval(iv.value)}
            >
              {iv.label}
            </button>
          ))}
        </div>

        {anyFetching && (
          <span
            className="muted"
            style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <RefreshCw size={12} className="spin" /> Verversen…
          </span>
        )}
      </div>

      {/* ── KPI-rij ── */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 20,
        }}
      >
        {kpis.isLoading || !kpis.data ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={108} />)
        ) : (
          <>
            <KpiCard
              label="Omzet"
              value={money(kpis.data.revenue)}
              icon={CircleDollarSign}
              size="sm"
            />
            <KpiCard
              label="Orders"
              value={formatNumber(kpis.data.orders)}
              icon={ShoppingBag}
              size="sm"
            />
            <KpiCard
              label="Gem. orderwaarde"
              value={money(kpis.data.aov)}
              icon={Receipt}
              size="sm"
            />
            <KpiCard
              label="Verkochte stuks"
              value={formatNumber(kpis.data.units)}
              icon={Boxes}
              size="sm"
            />
            <KpiCard
              label="Refunds"
              value={money(kpis.data.refunds)}
              icon={Undo2}
              size="sm"
            />
            <KpiCard
              label="Nieuwe klanten"
              value={formatNumber(kpis.data.newCustomers)}
              icon={UserPlus}
              size="sm"
            />
          </>
        )}
      </section>

      {/* ── Omzet-over-tijd + top-producten ── */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <Panel
          title="Omzet over tijd"
          subtitle={`Per ${INTERVALS.find((i) => i.value === interval)?.label.toLowerCase() ?? 'dag'} · in EUR`}
          isLoading={sales.isLoading}
          isError={sales.isError}
          onRetry={() => void sales.refetch()}
          isEmpty={
            !sales.data ||
            sales.data.series.length === 0 ||
            sales.data.series.every((d) => parseMoney(d.revenue) === 0)
          }
          emptyIcon={TrendingUp}
          emptyTitle="Geen omzet in deze periode"
          emptyDescription="Er is nog geen betaalde omzet voor de gekozen filters."
        >
          {sales.data && (
            <AreaChart
              data={sales.data.series.map((d) => ({
                label: new Date(d.period).toLocaleDateString('nl-NL', {
                  day: '2-digit',
                  month: 'short',
                }),
                value: parseMoney(d.revenue),
              }))}
            />
          )}
        </Panel>

        <Panel
          title="Top producten"
          subtitle="Omzet in deze periode"
          isLoading={topProducts.isLoading}
          isError={topProducts.isError}
          onRetry={() => void topProducts.refetch()}
          isEmpty={(topProducts.data ?? []).length === 0}
          emptyIcon={Package}
          emptyTitle="Nog geen verkochte producten"
          emptyDescription="Zodra er orders binnenkomen verschijnen hier de best verkochte producten."
        >
          {topProducts.data && (
            <HBarChart
              data={topProducts.data.slice(0, 8).map((p) => ({
                label: p.title,
                value: parseMoney(p.revenue),
              }))}
              format={moneyNum}
            />
          )}
        </Panel>
      </section>

      {/* ── Kanaal- + shop-verdeling ── */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <Panel
          title="Kanaal-verdeling"
          subtitle="Omzet-aandeel per verkoopkanaal"
          isLoading={channelBreakdown.isLoading}
          isError={channelBreakdown.isError}
          onRetry={() => void channelBreakdown.refetch()}
          isEmpty={(channelBreakdown.data ?? []).length === 0}
          emptyIcon={Layers}
          emptyTitle="Geen kanaal-data"
          emptyDescription="Er zijn nog geen orders met kanaal-toewijzing."
        >
          {channelBreakdown.data && (
            <ShareList
              rows={channelBreakdown.data.map((r) => ({
                label: r.channel || 'onbekend',
                revenue: r.revenue,
                orders: r.orders,
                share: r.share,
              }))}
            />
          )}
        </Panel>

        <Panel
          title="Shop-verdeling"
          subtitle="Omzet-aandeel per shop"
          isLoading={shopBreakdown.isLoading}
          isError={shopBreakdown.isError}
          onRetry={() => void shopBreakdown.refetch()}
          isEmpty={(shopBreakdown.data ?? []).length === 0}
          emptyIcon={Store}
          emptyTitle="Geen shop-data"
          emptyDescription="Er zijn nog geen orders om per shop te verdelen."
        >
          {shopBreakdown.data && (
            <ShareList
              rows={shopBreakdown.data.map((r) => ({
                label: r.shop || r.shopId,
                revenue: r.revenue,
                orders: r.orders,
                share: r.share,
              }))}
            />
          )}
        </Panel>
      </section>

      {/* ── Top-producten-tabel ── */}
      <section style={{ marginBottom: 20 }}>
        <Panel
          title="Best-sellers"
          subtitle="Top producten op omzet"
          isLoading={topProducts.isLoading}
          isError={topProducts.isError}
          onRetry={() => void topProducts.refetch()}
          isEmpty={(topProducts.data ?? []).length === 0}
          emptyIcon={Package}
          emptyTitle="Nog geen verkochte producten"
          tableLoading
        >
          {topProducts.data && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th style={{ textAlign: 'right' }}>Stuks</th>
                    <th style={{ textAlign: 'right' }}>Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.data.map((p, i) => (
                    <tr key={`${p.variantId ?? p.productId ?? 'x'}-${i}`}>
                      <td>{p.title}</td>
                      <td>
                        {p.sku ? <code className="mono">{p.sku}</code> : <span className="muted">—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatNumber(p.unitsSold)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {money(p.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>

      {/* ── Low-stock + top-klanten ── */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 16,
        }}
      >
        <Panel
          title="Lage voorraad"
          subtitle="Items onder drempel · met reorder-suggestie"
          isLoading={lowStock.isLoading}
          isError={lowStock.isError}
          onRetry={() => void lowStock.refetch()}
          isEmpty={(lowStock.data ?? []).length === 0}
          emptyIcon={AlertTriangle}
          emptyTitle="Alles op voorraad"
          emptyDescription="Geen items onder de drempel van 5 stuks."
          tableLoading
        >
          {lowStock.data && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th style={{ textAlign: 'right' }}>Voorradig</th>
                    <th style={{ textAlign: 'right' }}>Bijbestellen</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.data.map((it, i) => (
                    <tr key={`${it.variantId ?? it.productId ?? 'x'}-${i}`}>
                      <td>{it.title}</td>
                      <td>
                        {it.sku ? <code className="mono">{it.sku}</code> : <span className="muted">—</span>}
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          color: it.available <= 0 ? 'var(--danger)' : 'var(--warning)',
                          fontWeight: 600,
                        }}
                      >
                        {formatNumber(it.available)}
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--theme-accent)',
                          fontWeight: 600,
                        }}
                      >
                        +{formatNumber(it.reorderSuggested)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Top klanten"
          subtitle="Op omzet in deze periode"
          isLoading={topCustomers.isLoading}
          isError={topCustomers.isError}
          onRetry={() => void topCustomers.refetch()}
          isEmpty={(topCustomers.data ?? []).length === 0}
          emptyIcon={Users}
          emptyTitle="Nog geen klanten"
          emptyDescription="Zodra er betaalde orders zijn verschijnen hier de top-klanten."
          tableLoading
        >
          {topCustomers.data && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Klant</th>
                    <th style={{ textAlign: 'right' }}>Orders</th>
                    <th style={{ textAlign: 'right' }}>Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.data.map((cust, i) => (
                    <tr key={`${cust.customerId ?? cust.email}-${i}`}>
                      <td>{cust.email}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatNumber(cust.orders)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {money(cust.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
}

/* ─── Generieke panel-wrapper (loading/error/empty per paneel) ──── */

interface PanelProps {
  title: string;
  subtitle?: string;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isEmpty: boolean;
  emptyIcon: typeof Package;
  emptyTitle: string;
  emptyDescription?: string;
  /** Toon skeleton-tabel-rijen i.p.v. een blok-skeleton tijdens laden. */
  tableLoading?: boolean;
  children: React.ReactNode;
}

function Panel({
  title,
  subtitle,
  isLoading,
  isError,
  onRetry,
  isEmpty,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  tableLoading,
  children,
}: PanelProps) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">{title}</h2>
          {subtitle && <p className="card-subtitle">{subtitle}</p>}
        </div>
      </div>
      {isError ? (
        <div>
          <p className="error-text" style={{ margin: '0 0 12px' }}>
            Kon dit paneel niet laden.
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            <RefreshCw size={13} /> Opnieuw proberen
          </button>
        </div>
      ) : isLoading ? (
        tableLoading ? (
          <SkeletonTableRows rows={5} />
        ) : (
          <Skeleton height={220} />
        )
      ) : isEmpty ? (
        <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
      ) : (
        children
      )}
    </div>
  );
}

/* ─── Share-list (breakdown met balk + aandeel) ──────────────── */

function ShareList({
  rows,
}: {
  rows: Array<{ label: string; revenue: string; orders: number; share: number }>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12.5,
              marginBottom: 4,
              gap: 8,
            }}
          >
            <span
              style={{
                color: 'var(--theme-text)',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.label}
            </span>
            <span
              style={{
                color: 'var(--theme-muted)',
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {money(r.revenue)} · {pct(r.share)}
            </span>
          </div>
          <div
            style={{
              height: 8,
              background: 'var(--surface-1)',
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.max(2, r.share * 100)}%`,
                background:
                  'linear-gradient(90deg, var(--theme-accent), var(--theme-accent-secondary))',
                borderRadius: 999,
                transition: 'width var(--duration-base) var(--ease)',
              }}
            />
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--theme-muted)',
              marginTop: 3,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatNumber(r.orders)} orders
          </div>
        </div>
      ))}
    </div>
  );
}
