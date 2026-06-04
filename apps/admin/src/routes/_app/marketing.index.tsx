/**
 * /marketing (index) — marketing-cockpit op de ECHTE feeds-API (`/api/feeds/*`).
 *
 * Twee secties, beide PER SHOP (shop_id query-param):
 *   (a) PRODUCT-FEEDS — per channel (google_shopping, meta) een card met
 *       enabled-toggle, includeOutOfStock, currency, lastBuiltAt, een "Rebuild"-
 *       knop (toont item-count) en een copy-bare publieke feed-URL.
 *   (b) ANALYTICS & TRACKING — een formulier voor GA4 / Meta Pixel / Google Ads /
 *       custom head-HTML + enabled, opgeslagen via PUT /feeds/analytics.
 *
 * Een shop-selector bovenaan (alleen zichtbaar bij meerdere shops) stuurt welke
 * shop bewerkt wordt; default = de actieve shop uit de shop-context.
 *
 * NB: INDEX-route van het marketing-layout (marketing.tsx, pure <Outlet/>).
 */
import { createFileRoute } from '@tanstack/react-router';
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  Megaphone,
  Store,
  RefreshCcw,
  Copy,
  Check,
  ExternalLink,
  LineChart,
  Save,
  ShoppingBag,
} from 'lucide-react';
import { useActiveShop } from '@/lib/shop-context';
import {
  useAnalyticsConfig,
  useUpsertAnalyticsConfig,
  useFeedConfigs,
  useUpsertFeedConfig,
  useRebuildFeed,
  feedChannelMeta,
  FEED_CHANNELS,
  type FeedConfigDto,
  type FeedChannel,
  type AnalyticsConfigDto,
  type UpsertAnalyticsInput,
} from '@/components/marketing/api';
import { KpiCard } from '@/components/ui/KpiCard';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { formatRelative } from '@/lib/format';
import { asApiError } from '@/lib/api';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/marketing/')({
  component: MarketingPage,
});

const CURRENCIES = ['EUR', 'USD', 'GBP'];

/**
 * Bouw een absolute URL voor de operator: de backend levert een absolute URL met
 * PUBLIC_BASE_URL, maar in dev/preview is de admin-origin handiger. We pakken het
 * PAD uit de backend-URL en plakken er window.location.origin voor — dan klopt
 * de host met waar de admin draait.
 */
function buildOriginUrl(absoluteOrPath: string): string {
  try {
    const u = new URL(absoluteOrPath, window.location.origin);
    return `${window.location.origin}${u.pathname}${u.search}`;
  } catch {
    return absoluteOrPath;
  }
}

function MarketingPage() {
  const { shops, activeShopId } = useActiveShop();

  // Shop-keuze: default actieve shop. Wisselt bij shop-context-load.
  const [shopId, setShopId] = useState<string | null>(activeShopId);
  useEffect(() => {
    if (!shopId && activeShopId) setShopId(activeShopId);
  }, [activeShopId, shopId]);

  const activeShop = shops.find((s) => s.id === shopId) ?? null;

  const feeds = useFeedConfigs(shopId);
  const analytics = useAnalyticsConfig(shopId);

  // Map bestaande feed-configs per channel; ontbrekende channels tonen we als
  // "nog niet ingericht" (PUT maakt de rij bij eerste wijziging aan).
  const feedByChannel = useMemo(() => {
    const map = new Map<string, FeedConfigDto>();
    for (const f of feeds.data ?? []) map.set(f.channel, f);
    return map;
  }, [feeds.data]);

  const enabledFeeds = (feeds.data ?? []).filter((f) => f.enabled).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Marketing</h1>
            <span className="count-badge">{FEED_CHANNELS.length}</span>
          </div>
          <p className="page-subtitle">
            Product-feeds voor Google Shopping &amp; Meta, plus analytics &amp; tracking-pixels
            per shop.
          </p>
        </div>

        {shops.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Store size={14} style={{ color: 'var(--theme-muted)' }} />
            <select
              aria-label="Shop-selector"
              value={shopId ?? ''}
              onChange={(e) => setShopId(e.target.value || null)}
            >
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!shopId ? (
        <EmptyState
          icon={Store}
          title="Nog geen shop"
          description="Marketing-feeds en tracking zijn per shop. Maak eerst een shop aan."
        />
      ) : (
        <>
          {/* KPI-strip */}
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
              marginBottom: 24,
            }}
          >
            <KpiCard
              label="Actieve feeds"
              value={feeds.isLoading ? '—' : `${enabledFeeds}/${FEED_CHANNELS.length}`}
              icon={ShoppingBag}
              size="sm"
              hint="Google Shopping + Meta"
            />
            <KpiCard
              label="Analytics"
              value={
                analytics.isLoading
                  ? '—'
                  : analytics.data?.enabled
                    ? 'Actief'
                    : 'Uit'
              }
              icon={LineChart}
              size="sm"
              hint="GA4 / Pixel / Ads"
            />
            <KpiCard
              label="Shop"
              value={activeShop?.name ?? '—'}
              icon={Store}
              size="sm"
              hint={activeShop?.slug ? `/${activeShop.slug}` : undefined}
            />
          </section>

          {/* ─── (a) PRODUCT-FEEDS ─────────────────────────────── */}
          <section style={{ marginBottom: 32 }}>
            <SectionHeader
              icon={ShoppingBag}
              title="Product-feeds"
              subtitle="Genereer Google Shopping (XML) en Meta-catalog (CSV) feeds uit je gepubliceerde producten."
            />

            {feeds.isError ? (
              <ErrorCard
                message="Kon feed-configuraties niet laden."
                onRetry={() => void feeds.refetch()}
              />
            ) : feeds.isLoading ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                  gap: 16,
                }}
              >
                {FEED_CHANNELS.map((ch) => (
                  <SkeletonCard key={ch} height={280} />
                ))}
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                  gap: 16,
                }}
              >
                {FEED_CHANNELS.map((ch) => (
                  <FeedCard
                    key={ch}
                    channel={ch}
                    shopId={shopId}
                    config={feedByChannel.get(ch) ?? null}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ─── (b) ANALYTICS & TRACKING ──────────────────────── */}
          <section>
            <SectionHeader
              icon={LineChart}
              title="Analytics &amp; tracking"
              subtitle="Tags die de storefront client-side rendert. Laat een veld leeg om die tag uit te zetten."
            />

            {analytics.isError ? (
              <ErrorCard
                message="Kon analytics-configuratie niet laden."
                onRetry={() => void analytics.refetch()}
              />
            ) : analytics.isLoading ? (
              <div className="card">
                <Skeleton height={20} width="40%" />
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Skeleton height={38} />
                  <Skeleton height={38} />
                  <Skeleton height={38} />
                  <Skeleton height={80} />
                </div>
              </div>
            ) : (
              <AnalyticsForm shopId={shopId} config={analytics.data ?? null} />
            )}
          </section>
        </>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
}

/* ─── Section header ────────────────────────────────────────── */

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Megaphone;
  title: string;
  subtitle: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--theme-accent-subtle)',
          border: '1px solid var(--theme-accent-border)',
          color: 'var(--theme-accent)',
          flexShrink: 0,
        }}
      >
        <Icon size={17} />
      </div>
      <div>
        <h2 className="card-title" style={{ marginBottom: 2 }}>
          {title}
        </h2>
        <p className="card-subtitle" style={{ margin: 0 }}>
          {subtitle}
        </p>
      </div>
    </div>
  );
}

/* ─── Product-feed card ─────────────────────────────────────── */

function FeedCard({
  channel,
  shopId,
  config,
}: {
  channel: FeedChannel;
  shopId: string;
  config: FeedConfigDto | null;
}) {
  const meta = feedChannelMeta(channel);
  const upsert = useUpsertFeedConfig(shopId);
  const rebuild = useRebuildFeed(shopId);
  const [itemCount, setItemCount] = useState<number | null>(null);

  // Lokale (optimistische) defaults zodat een nog-niet-aangemaakte feed toch een
  // bedienbare card toont. PUT maakt de rij aan zodra de operator iets wijzigt.
  const enabled = config?.enabled ?? false;
  const includeOutOfStock = config?.includeOutOfStock ?? false;
  const currency = config?.currency ?? 'EUR';

  async function patch(input: Parameters<typeof upsert.mutateAsync>[0]) {
    try {
      await upsert.mutateAsync(input);
      toast.success(`${meta.label}: instelling opgeslagen.`);
    } catch (err) {
      toast.error(`Opslaan mislukt: ${asApiError(err).message}`);
    }
  }

  async function doRebuild() {
    if (!config) {
      toast.info('Sla eerst een instelling op zodat de feed bestaat, en rebuild dan.');
      return;
    }
    try {
      const res = await rebuild.mutateAsync(config.id);
      setItemCount(res.itemCount);
      toast.success(`${meta.label}: feed herbouwd — ${res.itemCount} item(s).`);
    } catch (err) {
      toast.error(`Rebuild mislukt: ${asApiError(err).message}`);
    }
  }

  return (
    <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at top right, ${meta.accent}12, transparent 60%)`,
          pointerEvents: 'none',
        }}
      />
      <div className="card-header" style={{ alignItems: 'flex-start', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 11,
              background: meta.accent,
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 19,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              flexShrink: 0,
            }}
          >
            {meta.letter}
          </div>
          <div>
            <h3 className="card-title" style={{ marginBottom: 3 }}>
              {meta.label}
            </h3>
            <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>
              {meta.kind}
            </span>
          </div>
        </div>
        <Toggle
          checked={enabled}
          disabled={upsert.isPending}
          onChange={(v) => void patch({ channel, enabled: v })}
        />
      </div>

      {/* Settings rij */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginBottom: 12,
          position: 'relative',
        }}
      >
        <FormField label="Valuta">
          <select
            value={currency}
            disabled={upsert.isPending}
            onChange={(e) => void patch({ channel, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FormField>
        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 14 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12.5,
              cursor: upsert.isPending ? 'not-allowed' : 'pointer',
              color: 'var(--theme-text)',
            }}
          >
            <input
              type="checkbox"
              checked={includeOutOfStock}
              disabled={upsert.isPending}
              onChange={(e) => void patch({ channel, includeOutOfStock: e.target.checked })}
              style={{ width: 14, height: 14 }}
            />
            Incl. uitverkocht
          </label>
        </div>
      </div>

      {/* Last built + rebuild */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          background: 'var(--surface-2)',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
          marginBottom: 12,
          position: 'relative',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--theme-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
            }}
          >
            Laatst gebouwd
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 2 }}>
            {config?.lastBuiltAt ? formatRelative(config.lastBuiltAt) : 'nog nooit'}
            {itemCount !== null && (
              <span style={{ color: 'var(--theme-accent)' }}> · {itemCount} items</span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void doRebuild()}
          disabled={rebuild.isPending}
          title={!config ? 'Sla eerst een instelling op' : 'Herbouw de feed-snapshot'}
        >
          <RefreshCcw size={13} className={rebuild.isPending ? 'spin' : ''} />
          {rebuild.isPending ? 'Bouwen…' : 'Rebuild'}
        </button>
      </div>

      {/* Public feed URL */}
      <CopyUrl
        url={config ? buildOriginUrl(config.publicFeedUrl) : null}
        hint={meta.hint}
      />
    </div>
  );
}

/* ─── Analytics & tracking form ─────────────────────────────── */

function AnalyticsForm({
  shopId,
  config,
}: {
  shopId: string;
  config: AnalyticsConfigDto | null;
}) {
  const upsert = useUpsertAnalyticsConfig(shopId);

  const [form, setForm] = useState({
    ga4MeasurementId: config?.ga4MeasurementId ?? '',
    metaPixelId: config?.metaPixelId ?? '',
    googleAdsId: config?.googleAdsId ?? '',
    googleAdsConversionLabel: config?.googleAdsConversionLabel ?? '',
    customHeadHtml: config?.customHeadHtml ?? '',
    enabled: config?.enabled ?? true,
  });

  // Sync de form-state als de geladen config wisselt (bv. na shop-wissel).
  useEffect(() => {
    setForm({
      ga4MeasurementId: config?.ga4MeasurementId ?? '',
      metaPixelId: config?.metaPixelId ?? '',
      googleAdsId: config?.googleAdsId ?? '',
      googleAdsConversionLabel: config?.googleAdsConversionLabel ?? '',
      customHeadHtml: config?.customHeadHtml ?? '',
      enabled: config?.enabled ?? true,
    });
  }, [config]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Lege strings → null zodat de backend de tag uitzet (de zod-schema doet dit
    // ook, maar we sturen null expliciet voor de duidelijkheid).
    const payload: UpsertAnalyticsInput = {
      ga4MeasurementId: form.ga4MeasurementId.trim() || null,
      metaPixelId: form.metaPixelId.trim() || null,
      googleAdsId: form.googleAdsId.trim() || null,
      googleAdsConversionLabel: form.googleAdsConversionLabel.trim() || null,
      customHeadHtml: form.customHeadHtml.trim() || null,
      enabled: form.enabled,
    };
    try {
      await upsert.mutateAsync(payload);
      toast.success('Analytics-configuratie opgeslagen.');
    } catch (err) {
      toast.error(`Opslaan mislukt: ${asApiError(err).message}`);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <div className="card-header">
        <div>
          <h3 className="card-title">Tracking-tags</h3>
          <p className="card-subtitle">
            De storefront haalt deze op via{' '}
            <code className="mono">/analytics.json</code> en injecteert per ingevulde
            id de juiste tag.
          </p>
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            color: 'var(--theme-text)',
          }}
        >
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} />
          {form.enabled ? 'Actief' : 'Uit'}
        </label>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 0,
          columnGap: 16,
        }}
      >
        <FormField
          label="GA4 Measurement ID"
          hint="Google Analytics 4 — formaat G-XXXXXXXXXX."
        >
          <input
            type="text"
            value={form.ga4MeasurementId}
            onChange={(e) => set('ga4MeasurementId', e.target.value)}
            placeholder="G-XXXXXXXXXX"
          />
        </FormField>

        <FormField label="Meta Pixel ID" hint="Facebook / Instagram pixel — numeriek.">
          <input
            type="text"
            value={form.metaPixelId}
            onChange={(e) => set('metaPixelId', e.target.value)}
            placeholder="123456789012345"
          />
        </FormField>

        <FormField label="Google Ads ID" hint="Conversie-tag — formaat AW-123456789.">
          <input
            type="text"
            value={form.googleAdsId}
            onChange={(e) => set('googleAdsId', e.target.value)}
            placeholder="AW-123456789"
          />
        </FormField>

        <FormField
          label="Google Ads conversie-label"
          hint="Het label achter de Ads-id (per conversie-actie)."
        >
          <input
            type="text"
            value={form.googleAdsConversionLabel}
            onChange={(e) => set('googleAdsConversionLabel', e.target.value)}
            placeholder="abcDEF123"
          />
        </FormField>
      </div>

      <FormField
        label="Custom head-HTML"
        hint="Rauwe HTML die in de <head> van de storefront komt. Eigen verantwoordelijkheid — geen validatie."
      >
        <textarea
          value={form.customHeadHtml}
          onChange={(e) => set('customHeadHtml', e.target.value)}
          rows={4}
          placeholder="<!-- bv. extra meta-tags of een verificatie-snippet -->"
          style={{
            width: '100%',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 12.5,
            resize: 'vertical',
          }}
        />
      </FormField>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button type="submit" className="btn btn-primary" disabled={upsert.isPending}>
          <Save size={14} />
          {upsert.isPending ? 'Opslaan…' : 'Opslaan'}
        </button>
      </div>
    </form>
  );
}

/* ─── Reusable: copy-bare URL ───────────────────────────────── */

function CopyUrl({ url, hint }: { url: string | null; hint: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('URL gekopieerd naar klembord.');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Kopiëren mislukt — selecteer en kopieer handmatig.');
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          fontSize: 10.5,
          color: 'var(--theme-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        Publieke feed-URL
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <code
          className="mono"
          style={{
            flex: 1,
            minWidth: 0,
            padding: '8px 10px',
            background: 'var(--surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 8,
            fontSize: 11.5,
            color: url ? 'var(--text-soft)' : 'var(--theme-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={url ?? undefined}
        >
          {url ?? 'Sla eerst een instelling op om de feed-URL te genereren.'}
        </code>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void copy()}
          disabled={!url}
          title="Kopieer URL"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        {url && (
          <a
            className="btn btn-secondary btn-sm"
            href={url}
            target="_blank"
            rel="noreferrer"
            title="Open in nieuw tabblad"
          >
            <ExternalLink size={13} />
          </a>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--theme-muted)', marginTop: 6 }}>{hint}</div>
    </div>
  );
}

/* ─── Reusable: toggle-switch ───────────────────────────────── */

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 999,
        border: '1px solid var(--border-default)',
        background: checked ? 'var(--theme-accent)' : 'var(--surface-3)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'background 140ms var(--ease)',
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          transition: 'left 140ms var(--ease)',
        }}
      />
    </button>
  );
}

/* ─── Reusable: error-card ──────────────────────────────────── */

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
      <p className="error-text" style={{ margin: 0 }}>
        {message} Controleer of de backend draait en probeer opnieuw.
      </p>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        style={{ marginTop: 12 }}
        onClick={onRetry}
      >
        <RefreshCcw size={13} /> Opnieuw proberen
      </button>
    </div>
  );
}
