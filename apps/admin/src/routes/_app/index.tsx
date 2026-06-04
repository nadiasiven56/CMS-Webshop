/**
 * Dashboard (/) — KPI-overzicht op de ECHTE API (`GET /api/dashboard/kpis`).
 *
 * Geen mock-state meer: alle cijfers, charts en recent-activity komen uit de
 * backend. Een filter-bar bovenaan stuurt `shop_id` + `channel` als query-params
 * mee; een filter-wissel herquerient en de cijfers verversen. "Alle shops" =
 * shop_id weglaten (de endpoint aggregeert dan over alle shops).
 *
 * Quick-actions: navigatie-shortcuts + een ECHTE kanaal-sync
 * (`POST /api/channels/:id/sync`) i.p.v. de oude fake GMC/Moneybird-knoppen.
 * De channel-picker-drawer kiest welk kanaal gesynct wordt.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  Globe,
  Package,
  Plus,
  RefreshCw,
  ShoppingBag,
  Store,
  TrendingUp,
  AlertTriangle,
  LogIn,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  useDashboardKpis,
  useChannelOptions,
  useSyncChannel,
  type DashboardFilters,
} from '@/components/dashboard/api';
import { useActiveShop } from '@/lib/shop-context';
import { KpiCard } from '@/components/ui/KpiCard';
import { Sparkline, AreaChart, HBarChart } from '@/components/ui/Sparkline';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
});

const CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Alle kanalen' },
  { value: 'web', label: 'Webshop' },
  { value: 'bol', label: 'Bol.com' },
  { value: 'amazon', label: 'Amazon' },
];

/** Sentinel voor "Alle shops" in de shop-selector (shop_id wordt dan weggelaten). */
const ALL_SHOPS = '__all__';

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(v);
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'zojuist';
  if (min < 60) return `${min} min geleden`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} uur geleden`;
  const days = Math.floor(hours / 24);
  return `${days} dag${days > 1 ? 'en' : ''} geleden`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Goedenacht';
  if (h < 12) return 'Goedemorgen';
  if (h < 18) return 'Goedemiddag';
  return 'Goedenavond';
}

const ACTIVITY_ICONS: Record<string, { icon: any; cls: string }> = {
  order: { icon: ShoppingBag, cls: 'icon-order' },
  stock: { icon: Boxes, cls: 'icon-stock' },
  product: { icon: Package, cls: 'icon-product' },
  login: { icon: LogIn, cls: 'icon-login' },
};

function DashboardPage() {
  const auth = useAuth();
  const user = auth.data;
  const { shops, activeShopId } = useActiveShop();

  // ── Filter-state: shop (of "alle") + kanaal ──────────────────
  // Default = de actieve shop, zodat het dashboard meteen relevant is.
  const [shopFilter, setShopFilter] = useState<string>(activeShopId ?? ALL_SHOPS);
  const [channel, setChannel] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);

  // Als de shop-context pas later laadt, val terug op de actieve shop.
  const effectiveShop = shopFilter === ALL_SHOPS ? ALL_SHOPS : shopFilter || activeShopId || ALL_SHOPS;

  const filters: DashboardFilters = useMemo(
    () => ({
      shopId: effectiveShop === ALL_SHOPS ? null : effectiveShop,
      channel: channel || undefined,
    }),
    [effectiveShop, channel],
  );

  const query = useDashboardKpis(filters);
  const kpis = query.data;
  const isLoading = query.isLoading;

  const today = new Intl.DateTimeFormat('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <div>
      <header style={{ marginBottom: 20 }}>
        <h1 className="page-title">
          {greeting()}{user ? `, ${user.email.split('@')[0]}` : ''}.
        </h1>
        <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>{today}</p>
      </header>

      {/* Filter-bar: shop + kanaal */}
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

        <div className="segmented" role="tablist" aria-label="Kanaal-filter">
          {CHANNEL_OPTIONS.map((c) => (
            <button
              key={c.value || 'all'}
              type="button"
              role="tab"
              data-active={channel === c.value}
              onClick={() => setChannel(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {query.isFetching && !isLoading && (
          <span className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <RefreshCw size={12} className="spin" /> Verversen…
          </span>
        )}
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text" style={{ margin: 0 }}>
            Kon dashboard-cijfers niet laden. Controleer of de backend draait en probeer een
            pagina-refresh.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 12 }}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={13} /> Opnieuw proberen
          </button>
        </div>
      ) : (
        <>
          {/* KPI grid */}
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 14,
              marginBottom: 20,
            }}
          >
            {isLoading || !kpis ? (
              <>
                <Skeleton height={120} />
                <Skeleton height={120} />
                <Skeleton height={120} />
                <Skeleton height={120} />
              </>
            ) : (
              <>
                <KpiCard
                  label="Omzet (30d)"
                  value={formatCurrency(kpis.revenue30d)}
                  delta={kpis.revenue30dDelta}
                  icon={CircleDollarSign}
                >
                  <Sparkline
                    values={kpis.revenueSeries.map((d) => d.revenue)}
                    fill
                    height={28}
                  />
                </KpiCard>

                <KpiCard
                  label="Open orders"
                  value={kpis.openOrders}
                  icon={ShoppingBag}
                  hint={
                    <span>
                      <span className="badge badge-warning" style={{ marginRight: 6 }}>
                        {kpis.openOrdersUnpaid} onbetaald
                      </span>
                      <span className="badge badge-info">
                        {kpis.openOrdersToShip} te verzenden
                      </span>
                    </span>
                  }
                />

                <KpiCard
                  label="Low-stock items"
                  value={kpis.lowStockCount}
                  icon={AlertTriangle}
                  hint={
                    kpis.lowStockTop.length > 0 ? (
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {kpis.lowStockTop.slice(0, 3).map((s) => (
                          <span key={s.sku} style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>
                            <code className="mono">{s.sku}</code> · {s.available} st
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>
                        Alles op voorraad
                      </span>
                    )
                  }
                />

                <KpiCard
                  label="Channels"
                  value={`${kpis.channels.filter((c) => c.status === 'connected').length}/${kpis.channels.length}`}
                  icon={Globe}
                  hint={
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {kpis.channels.slice(0, 3).map((c) => (
                        <span key={c.name} style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>
                          {c.status === 'connected' ? (
                            <CheckCircle2 size={11} style={{ color: 'var(--success)', verticalAlign: 'middle', marginRight: 4 }} />
                          ) : (
                            <AlertTriangle size={11} style={{ color: 'var(--warning)', verticalAlign: 'middle', marginRight: 4 }} />
                          )}
                          {c.name}
                        </span>
                      ))}
                    </span>
                  }
                />
              </>
            )}
          </section>

          {/* Charts row */}
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
              gap: 16,
              marginBottom: 20,
            }}
          >
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Omzet per dag</h2>
                  <p className="card-subtitle">Laatste 30 dagen · in EUR</p>
                </div>
                {kpis && (
                  <span className={`badge ${kpis.revenue30dDelta >= 0 ? 'badge-success' : 'badge-warning'}`}>
                    <TrendingUp size={11} />
                    {kpis.revenue30dDelta >= 0 ? '+' : ''}{kpis.revenue30dDelta.toFixed(1)}%
                  </span>
                )}
              </div>
              {isLoading || !kpis ? (
                <Skeleton height={220} />
              ) : kpis.revenueSeries.every((d) => d.revenue === 0) ? (
                <EmptyState
                  icon={TrendingUp}
                  title="Geen omzet in deze periode"
                  description="Er is nog geen betaalde omzet voor de gekozen shop/kanaal-combinatie."
                />
              ) : (
                <AreaChart
                  data={kpis.revenueSeries.map((d) => ({
                    label: new Date(d.day).toLocaleDateString('nl-NL', {
                      day: '2-digit',
                      month: 'short',
                    }),
                    value: d.revenue,
                  }))}
                />
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Top producten</h2>
                  <p className="card-subtitle">Omzet · laatste 30 dagen</p>
                </div>
              </div>
              {isLoading || !kpis ? (
                <Skeleton height={220} />
              ) : kpis.topProducts.length === 0 ? (
                <EmptyState
                  icon={Package}
                  title="Nog geen verkochte producten"
                  description="Zodra er orders binnenkomen verschijnen hier de best verkochte producten."
                />
              ) : (
                <HBarChart
                  data={kpis.topProducts.map((p) => ({ label: p.title, value: p.revenue }))}
                  format={formatCurrency}
                />
              )}
            </div>
          </section>

          {/* Activity + quick actions */}
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
              gap: 16,
            }}
          >
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Recent activity</h2>
                  <p className="card-subtitle">Laatste 10 events</p>
                </div>
                <Link to="/movements" className="btn btn-ghost btn-sm">
                  Movements <ArrowRight size={12} />
                </Link>
              </div>
              {isLoading || !kpis ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} height={36} />
                  ))}
                </div>
              ) : kpis.recentActivity.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title="Nog geen activiteit"
                  description="Acties op orders, voorraad en producten verschijnen hier zodra ze plaatsvinden."
                />
              ) : (
                <div className="activity-feed">
                  {kpis.recentActivity.map((act) => {
                    const cfg = ACTIVITY_ICONS[act.type] ?? ACTIVITY_ICONS.product!;
                    const Icon = cfg.icon;
                    return (
                      <div key={act.id} className="activity-item">
                        <div className={`activity-icon ${cfg.cls}`}>
                          <Icon size={13} strokeWidth={1.8} />
                        </div>
                        <div className="activity-text">
                          {act.text}
                          <div className="activity-actor">{act.actor}</div>
                        </div>
                        <span className="activity-time">{relativeTime(act.timestamp)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 16, alignSelf: 'start' }}>
              <div className="card-header" style={{ marginBottom: 12 }}>
                <h2 className="card-title">Quick actions</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <QuickAction
                  icon={<Plus size={14} />}
                  label="Nieuw product"
                  to="/products/new"
                  primary
                />
                <QuickAction icon={<Boxes size={14} />} label="Voorraad-overzicht" to="/stock" />
                <QuickAction
                  icon={<Activity size={14} />}
                  label="Movements-log"
                  to="/movements"
                />
                <QuickAction
                  icon={<RefreshCw size={14} />}
                  label="Kanaal synchroniseren"
                  onClick={() => setSyncOpen(true)}
                />
                <QuickAction
                  icon={<Globe size={14} />}
                  label="Kanalen beheren"
                  to="/channels"
                />
              </div>
            </div>
          </section>
        </>
      )}

      <SyncChannelDrawer open={syncOpen} onClose={() => setSyncOpen(false)} />

      {/* tiny inline keyframe for spinner (same as channels page) */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
}

/* ─── Sync-channel drawer (echte POST /api/channels/:id/sync) ───────────── */

function SyncChannelDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const channelsQuery = useChannelOptions();
  const sync = useSyncChannel();
  const [selected, setSelected] = useState<string>('');

  const channels = channelsQuery.data ?? [];

  async function runSync() {
    if (!selected) return;
    const ch = channels.find((c) => c.id === selected);
    try {
      const result = await sync.mutateAsync(selected);
      if (result.errors.length > 0) {
        toast.error(
          `${ch?.name ?? 'Kanaal'} gesynct met ${result.errors.length} fout(en) — ${result.ordersImported} orders, ${result.listingsPushed} listings`,
        );
      } else {
        toast.success(
          `${ch?.name ?? 'Kanaal'} gesynct — ${result.ordersImported} orders, ${result.listingsPushed} listings`,
        );
      }
      onClose();
    } catch (err) {
      const e = asApiError(err);
      if (e.code === 'channel_not_connected') {
        toast.error('Kanaal is niet verbonden — stel eerst credentials in bij Kanalen beheren.');
      } else {
        toast.error(`Sync mislukt: ${e.message}`);
      }
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Kanaal synchroniseren"
      subtitle="Importeer orders en push voorraad naar het gekozen verkoopkanaal."
      width={420}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Annuleer
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected || sync.isPending}
            onClick={() => void runSync()}
          >
            {sync.isPending ? (
              <>
                <RefreshCw size={14} className="spin" /> Synchroniseren…
              </>
            ) : (
              <>
                <RefreshCw size={14} /> Nu synchroniseren
              </>
            )}
          </button>
        </div>
      }
    >
      {channelsQuery.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      ) : channels.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="Geen kanalen"
          description="Er zijn nog geen verkoopkanalen ingericht. Voeg er een toe bij Kanalen beheren."
        />
      ) : (
        <FormField label="Kanaal" hint="Eigen webshop synct direct; marktplaatsen vereisen credentials.">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">— Kies een kanaal —</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.status})
              </option>
            ))}
          </select>
        </FormField>
      )}
    </Drawer>
  );
}

interface QuickActionProps {
  icon: ReactNode;
  label: string;
  to?: string;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  loading?: boolean;
}

function QuickAction({ icon, label, to, primary, disabled, onClick, loading }: QuickActionProps) {
  const content = (
    <>
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          display: 'grid',
          placeItems: 'center',
          background: primary ? 'var(--theme-accent-subtle)' : 'var(--surface-3)',
          color: primary ? 'var(--theme-accent)' : 'var(--theme-muted)',
          border: primary ? '1px solid var(--theme-accent-border)' : '1px solid var(--border-default)',
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{label}</span>
      <ArrowRight size={13} style={{ color: 'var(--text-faint)' }} />
    </>
  );
  const style = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--border-subtle)',
    background: 'var(--surface-2)',
    color: 'var(--theme-text)',
    textDecoration: 'none',
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled || loading ? 0.6 : 1,
    transition: 'background 120ms var(--ease), border-color 120ms var(--ease)',
  } as const;

  if (to && !disabled) {
    return (
      <Link to={to} style={style}>
        {content}
      </Link>
    );
  }
  if (onClick && !disabled) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        style={{ ...style, font: 'inherit', textAlign: 'left' }}
      >
        {content}
      </button>
    );
  }
  return <div style={style}>{content}</div>;
}
