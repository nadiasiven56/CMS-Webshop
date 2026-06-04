/**
 * /finance — financieel dashboard (echte data).
 *
 * Bronnen:
 *   - GET /api/finance/pnl                (discount-regel + fallback-totalen)
 *   - GET /api/finance/ledger/aggregate   (per-shop + per-kanaal + periode-bucket)
 *
 * Wave D2 — één geconsolideerde boekhouding:
 *   • Shop-scope: "Alle shops" (consolidatie) of één shop.
 *   • Kanaal-filter: alle kanalen of web/bol/amazon.
 *   • Per-kanaal-breakdown met omzet / BTW / marge + geconsolideerde totalen.
 *
 * De aggregate (source='orders') is de single source of truth voor de KPI's,
 * de per-kanaal-tabel én de P&L-tabel — zo blijft alles consistent onder elk
 * shop-/kanaal-filter. `/pnl` accepteert namelijk GEEN kanaal-filter, dus die
 * gebruiken we alleen voor de discount-regel als er geen kanaal-filter staat.
 *
 * Periode-toggle (dag/week/maand) bepaalt zowel het from→to-venster als de
 * aggregate-bucket. Geld blijft string → render via formatMoney(money(x)).
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import {
  Receipt,
  BookOpenCheck,
  TrendingUp,
  Percent,
  Banknote,
  Package,
  BarChart3,
  CalendarRange,
  AlertCircle,
  Store,
  Layers,
} from 'lucide-react';
import { KpiCard } from '@/components/ui/KpiCard';
import { Sparkline } from '@/components/ui/Sparkline';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { PnlTable } from '@/components/finance/PnlTable';
import {
  usePnl,
  useAggregate,
  money,
  channelLabel,
  derivePnlFromAggregate,
  SALES_CHANNELS,
  type Period,
} from '@/components/finance/api';
import { useActiveShop } from '@/lib/shop-context';
import { formatMoney, formatPct, formatNumber } from '@/lib/format';

export const Route = createFileRoute('/_app/finance')({
  component: FinancePage,
});

type RangeKey = 'day' | 'week' | 'month' | 'quarter' | 'year';

interface RangeCfg {
  key: RangeKey;
  label: string;
  /** Aantal dagen terug voor het from→to-venster. */
  days: number;
  /** Aggregate-bucket. */
  bucket: Period;
}

const RANGES: RangeCfg[] = [
  { key: 'day', label: 'Vandaag', days: 1, bucket: 'day' },
  { key: 'week', label: '7 dagen', days: 7, bucket: 'day' },
  { key: 'month', label: '30 dagen', days: 30, bucket: 'day' },
  { key: 'quarter', label: 'Kwartaal', days: 90, bucket: 'week' },
  { key: 'year', label: 'Jaar', days: 365, bucket: 'month' },
];

/** Sentinel voor "Alle shops" in de shop-scope-select. */
const ALL_SHOPS = '__all__';

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function FinancePage() {
  const { activeShopId, activeShop, shops } = useActiveShop();
  const [rangeKey, setRangeKey] = useState<RangeKey>('month');
  /** Shop-scope: ALL_SHOPS (geconsolideerd) of een concrete shop-id. */
  const [scope, setScope] = useState<string>(ALL_SHOPS);
  /** Kanaal-filter: '' (alle) of een kanaal-slug. */
  const [channel, setChannel] = useState<string>('');

  const range = RANGES.find((r) => r.key === rangeKey)!;
  const allShops = scope === ALL_SHOPS;
  const scopedShopId = allShops ? activeShopId : scope;

  const { from, to } = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - (range.days - 1));
    return { from: isoDay(start), to: isoDay(now) };
  }, [range.days]);

  // Aggregate is de bron voor KPI's + per-kanaal + P&L (respecteert shop+kanaal).
  const agg = useAggregate({
    shopId: scopedShopId,
    allShops,
    channel: channel || undefined,
    period: range.bucket,
    source: 'orders',
    from,
    to,
  });

  // /pnl alleen voor de discount-regel — en enkel als er geen kanaal-filter
  // actief is (de backend negeert `channel` op /pnl).
  const pnl = usePnl({
    shopId: scopedShopId,
    allShops,
    from,
    to,
    enabled: !channel && (allShops || !!scopedShopId),
  });

  const items = agg.data?.items ?? [];

  // Geconsolideerde P&L-samenvatting uit de aggregate-rows (alle shops + alle
  // kanalen binnen het huidige filter). Discount uit /pnl indien beschikbaar.
  const summary = useMemo(
    () =>
      derivePnlFromAggregate(items, {
        shopId: allShops ? null : scopedShopId,
        from,
        to,
        discount: !channel ? pnl.data?.discount : undefined,
      }),
    [items, allShops, scopedShopId, from, to, channel, pnl.data?.discount],
  );

  // Per-kanaal aggregatie (over alle shops + buckets binnen het filter sommeren).
  const byChannel = useMemo(() => {
    const map = new Map<
      string,
      {
        channel: string | null;
        revenueCents: number;
        vatCents: number;
        marginCents: number;
        orders: number;
      }
    >();
    for (const r of items) {
      const key = r.channel ?? '__direct__';
      const e =
        map.get(key) ??
        { channel: r.channel, revenueCents: 0, vatCents: 0, marginCents: 0, orders: 0 };
      e.revenueCents += Math.round(money(r.revenue) * 100);
      e.vatCents += Math.round(money(r.vat) * 100);
      e.marginCents += Math.round(money(r.margin) * 100);
      e.orders += r.orderCount ?? 0;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.revenueCents - a.revenueCents);
  }, [items]);

  // Geconsolideerde totalen over alle kanalen (footer van de per-kanaal-tabel).
  const channelTotals = useMemo(() => {
    return byChannel.reduce(
      (acc, c) => {
        acc.revenueCents += c.revenueCents;
        acc.vatCents += c.vatCents;
        acc.marginCents += c.marginCents;
        acc.orders += c.orders;
        return acc;
      },
      { revenueCents: 0, vatCents: 0, marginCents: 0, orders: 0 },
    );
  }, [byChannel]);

  // Trend-sparkline: omzet per bucket (chronologisch).
  const trend = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of items) {
      map.set(r.period, (map.get(r.period) ?? 0) + money(r.revenue));
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  }, [items]);

  const loading = agg.isLoading;
  const error = agg.isError;
  const hasData = summary.orderCount > 0;

  const scopeLabel = allShops
    ? `alle shops${shops.length ? ` (${shops.length})` : ''}`
    : (shops.find((s) => s.id === scope)?.name ?? activeShop?.name ?? 'shop');
  const channelText = channel ? ` · ${channelLabel(channel)}` : '';

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Financieel</h1>
          <p className="page-subtitle">
            Geconsolideerde boekhouding — omzet, marge en BTW over {scopeLabel}
            {channelText}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/ledger" className="btn btn-secondary">
            <BookOpenCheck size={14} /> Grootboek
          </Link>
          <Link to="/accounting" className="btn btn-secondary">
            <Receipt size={14} /> Boekhouding
          </Link>
        </div>
      </header>

      {/* Filterbar: shop-scope + kanaal + periode */}
      <div className="toolbar" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--theme-muted)' }}
        >
          <Store size={13} />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 12.5 }}
            aria-label="Shop"
          >
            <option value={ALL_SHOPS}>Alle shops</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--theme-muted)' }}
        >
          <Layers size={13} />
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 12.5 }}
            aria-label="Kanaal"
          >
            <option value="">Alle kanalen</option>
            {SALES_CHANNELS.map((ch) => (
              <option key={ch.value} value={ch.value}>
                {ch.label}
              </option>
            ))}
          </select>
        </label>

        <span
          style={{
            fontSize: 12,
            color: 'var(--theme-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginLeft: 8,
          }}
        >
          <CalendarRange size={13} /> Periode:
        </span>
        <div className="segmented" role="tablist" aria-label="Periode">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              data-active={rangeKey === r.key}
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-faint)' }}>
          {from} t/m {to}
        </span>
      </div>

      {!allShops && !scopedShopId ? (
        <EmptyState
          icon={AlertCircle}
          title="Geen shop geselecteerd"
          description="Kies een shop in de bovenbalk of zet de scope op 'Alle shops'."
        />
      ) : error ? (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <p className="error-text" style={{ color: 'var(--danger)' }}>
            Kon financiële data niet laden. Probeer een pagina-refresh.
          </p>
        </div>
      ) : (
        <>
          {/* KPI grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 14,
              marginBottom: 20,
            }}
          >
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={108} />)
            ) : (
              <>
                <KpiCard
                  label="Omzet (excl. BTW)"
                  value={formatMoney(money(summary.revenueNet))}
                  hint={`${formatNumber(summary.orderCount)} orders${channel ? ` · ${channelLabel(channel)}` : ''}`}
                  icon={TrendingUp}
                />
                <KpiCard
                  label="Bruto-marge"
                  value={formatMoney(money(summary.grossMargin))}
                  hint={`marge ${formatPct(summary.grossMarginPct)}`}
                  icon={Percent}
                />
                <KpiCard
                  label="BTW (af te dragen)"
                  value={formatMoney(money(summary.vat))}
                  hint="in periode"
                  icon={Banknote}
                />
                <KpiCard
                  label="Inkoopwaarde (COGS)"
                  value={formatMoney(money(summary.cogs))}
                  hint="excl. verzending"
                  icon={Package}
                />
              </>
            )}
          </div>

          {/* Trend */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div>
                <h2 className="card-title">
                  <BarChart3 size={14} style={{ display: 'inline', verticalAlign: -2 }} /> Omzettrend
                </h2>
                <p className="card-subtitle">Netto-omzet per {bucketLabel(range.bucket)}.</p>
              </div>
            </div>
            {loading ? (
              <Skeleton height={48} />
            ) : trend.length > 1 ? (
              <Sparkline values={trend} height={48} fill />
            ) : (
              <p className="muted" style={{ fontSize: 12.5 }}>
                Niet genoeg datapunten voor een trendlijn in deze periode.
              </p>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: 16,
              marginBottom: 16,
            }}
          >
            {/* Per-kanaal: omzet / BTW / marge + geconsolideerde totalen */}
            <div className="card card-flush">
              <div
                style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--border-default)',
                }}
              >
                <h2 className="card-title">Per kanaal</h2>
                <p className="card-subtitle">
                  Omzet, BTW en marge per verkoopkanaal{allShops ? ', over alle shops' : ''}.
                </p>
              </div>
              {loading ? (
                <div style={{ padding: 16 }}>
                  <Skeleton height={120} />
                </div>
              ) : byChannel.length === 0 ? (
                <div style={{ padding: 20 }}>
                  <p className="muted" style={{ fontSize: 12.5 }}>
                    Geen omzet in deze periode{channel ? ` voor ${channelLabel(channel)}` : ''}.
                  </p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Kanaal</th>
                        <th style={{ textAlign: 'right' }}>Orders</th>
                        <th style={{ textAlign: 'right' }}>Omzet</th>
                        <th style={{ textAlign: 'right' }}>BTW</th>
                        <th style={{ textAlign: 'right' }}>Marge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byChannel.map((c) => {
                        const rev = c.revenueCents / 100;
                        const mPct = rev > 0 ? c.marginCents / 100 / rev : 0;
                        return (
                          <tr key={c.channel ?? '__direct__'}>
                            <td>
                              <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>
                                {channelLabel(c.channel)}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {formatNumber(c.orders)}
                            </td>
                            <td
                              style={{
                                textAlign: 'right',
                                fontVariantNumeric: 'tabular-nums',
                                fontWeight: 600,
                              }}
                            >
                              {formatMoney(rev)}
                            </td>
                            <td
                              style={{
                                textAlign: 'right',
                                fontVariantNumeric: 'tabular-nums',
                                color: 'var(--theme-muted)',
                              }}
                            >
                              {formatMoney(c.vatCents / 100)}
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <span
                                style={{
                                  color:
                                    mPct >= 0.4
                                      ? 'var(--success)'
                                      : mPct >= 0.25
                                        ? 'var(--warning)'
                                        : 'var(--theme-muted)',
                                }}
                              >
                                {mPct > 0 ? formatPct(mPct) : '—'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr
                        style={{
                          borderTop: '2px solid var(--border-default)',
                          background: 'var(--surface-2)',
                        }}
                      >
                        <td style={{ fontWeight: 700 }}>Totaal</td>
                        <td
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 600,
                          }}
                        >
                          {formatNumber(channelTotals.orders)}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 700,
                          }}
                        >
                          {formatMoney(channelTotals.revenueCents / 100)}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 600,
                            color: 'var(--theme-muted)',
                          }}
                        >
                          {formatMoney(channelTotals.vatCents / 100)}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 700,
                            color: 'var(--success)',
                          }}
                        >
                          {channelTotals.revenueCents > 0
                            ? formatPct(channelTotals.marginCents / channelTotals.revenueCents)
                            : '—'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* P&L-tabel — geconsolideerd over het huidige shop-/kanaal-filter */}
            <div className="card card-flush">
              <div
                style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--border-default)',
                }}
              >
                <h2 className="card-title">Winst &amp; verlies</h2>
                <p className="card-subtitle">
                  Samenvatting over de gekozen periode{allShops ? ', geconsolideerd' : ''}.
                </p>
              </div>
              {loading ? (
                <div style={{ padding: 16 }}>
                  <Skeleton height={200} />
                </div>
              ) : !hasData ? (
                <div style={{ padding: 20 }}>
                  <p className="muted" style={{ fontSize: 12.5 }}>
                    Geen afgeronde orders in deze periode.
                  </p>
                </div>
              ) : (
                <PnlTable pnl={summary} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function bucketLabel(bucket: Period): string {
  return bucket === 'day' ? 'dag' : bucket === 'week' ? 'week' : 'maand';
}
