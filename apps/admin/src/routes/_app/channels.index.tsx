/**
 * /channels (index) — verkoop-kanalen op de ECHTE API (`/api/channels`).
 *
 * Vervangt de oude mock-state. Channels zijn NIET shop-scoped. Per kanaal een
 * card met echte status, productaantal (counts.products), order-import-count
 * (counts.orders) en laatste sync (lastSyncAt). "Configureren" opent de drawer
 * (credentials/config + test + sync), "Sync nu" roept de echte sync-endpoint.
 *
 * UX/look 1-op-1 behouden t.o.v. de oude preview — alleen de databron is nu echt.
 *
 * NB: dit is de INDEX-route van het channels-layout (channels.tsx). De layout
 * rendert enkel <Outlet/>; deze index toont de lijst op /channels, terwijl
 * /channels/matrix de matrix-child toont.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Plus, Settings as SettingsIcon, Layers, RefreshCcw,
  AlertTriangle, CheckCircle2, CircleDashed, ServerCrash,
} from 'lucide-react';
import { ChannelStatusPill } from '@/components/channels/ChannelStatusPill';
import { ChannelConfigDrawer } from '@/components/channels/ChannelConfigDrawer';
import {
  useChannels,
  useCreateChannel,
  useSyncChannel,
  channelTypeMeta,
  type ChannelDetailDto,
  type ChannelType,
} from '@/components/channels/api';
import { formatRelative, formatNumber } from '@/lib/format';
import { asApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/channels/')({
  component: ChannelsPage,
});

function ChannelsPage() {
  const query = useChannels();
  const [config, setConfig] = useState<ChannelDetailDto | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const channels = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  // Houd de geopende drawer-channel in sync met verse data na invalidatie.
  useEffect(() => {
    if (!config) return;
    const fresh = channels.find((c) => c.id === config.id);
    if (fresh && fresh !== config) setConfig(fresh);
  }, [channels]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Verkoop-kanalen</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">
            Eigen storefronts en marketplaces — sync-status, productaantallen en orders.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/channels/matrix" className="btn btn-secondary">
            <Layers size={14} /> Per-product matrix
          </Link>
          <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
            <Plus size={15} strokeWidth={2.2} />
            Kanaal toevoegen
          </button>
        </div>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">
            Kon kanalen niet laden. Controleer of de backend draait en probeer pagina-refresh.
          </p>
        </div>
      ) : query.isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} height={260} />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Nog geen kanalen"
          description="Voeg een verkoop-kanaal toe — eigen webshop, Bol.com, Amazon of Google Shopping."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> Kanaal toevoegen
            </button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
          {channels.map((c) => (
            <ChannelCard key={c.id} channel={c} onConfigure={() => setConfig(c)} />
          ))}

          {/* Add new card */}
          <button
            type="button"
            className="card"
            onClick={() => setAddOpen(true)}
            style={{
              border: '1px dashed var(--border-default)',
              background: 'transparent',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              minHeight: 280, cursor: 'pointer', color: 'var(--theme-muted)',
              padding: 24,
            }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: 'var(--surface-3)', border: '1px solid var(--border-default)',
              display: 'grid', placeItems: 'center', marginBottom: 12,
              color: 'var(--theme-accent)',
            }}>
              <Plus size={20} strokeWidth={2.4} />
            </div>
            <div style={{ fontWeight: 600, color: 'var(--theme-text)', marginBottom: 4 }}>
              Voeg kanaal toe
            </div>
            <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 240 }}>
              Connect Bol.com, Amazon, Google Shopping of een eigen storefront.
            </div>
          </button>
        </div>
      )}

      <ChannelConfigDrawer channel={config} onClose={() => setConfig(null)} />
      <AddChannelModal open={addOpen} onClose={() => setAddOpen(false)} />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
}

function ChannelCard({
  channel,
  onConfigure,
}: {
  channel: ChannelDetailDto;
  onConfigure: () => void;
}) {
  const meta = channelTypeMeta(channel.type);
  const sync = useSyncChannel(channel.id);
  // 'Gezet' alleen als de backend zegt dat er creds zijn ÉN de masked map
  // daadwerkelijk velden bevat. Een lege `{}` (column niet-null maar leeg/niet
  // ontsleutelbaar) telt NIET als ingesteld — anders toont het kanaal 'Gezet'
  // zonder bruikbare credentials.
  const hasUsableCredentials =
    channel.hasCredentials && Object.keys(channel.credentials ?? {}).length > 0;
  const needsCredentials = channel.type !== 'own_webshop' && !hasUsableCredentials;

  async function syncNow() {
    try {
      const res = await sync.mutateAsync();
      if (res.errors.length > 0) {
        toast.error(`${channel.name}: gesynced met ${res.errors.length} fout(en)`);
      } else {
        toast.success(
          `${channel.name}: ${res.ordersImported} order(s), ${res.listingsPushed} listing(s) gesynced`,
        );
      }
    } catch (err) {
      const e2 = asApiError(err);
      if (e2.code === 'channel_not_connected') {
        toast.error(`${channel.name} is niet verbonden — configureer credentials eerst.`);
      } else {
        toast.error(`Sync mislukt: ${e2.message}`);
      }
    }
  }

  return (
    <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(circle at top right, ${meta.accent}10, transparent 60%)`,
          pointerEvents: 'none',
        }}
      />
      <div className="card-header" style={{ alignItems: 'flex-start', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 46, height: 46, borderRadius: 11,
              background: meta.accent,
              display: 'grid', placeItems: 'center',
              color: '#fff', fontWeight: 800, fontSize: 20,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              flexShrink: 0,
            }}
          >
            {meta.letter}
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 className="card-title" style={{ marginBottom: 3 }}>{channel.name}</h2>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>{meta.kind}</span>
              <ChannelStatusPill status={channel.status} />
            </div>
          </div>
        </div>
        <StatusIcon status={channel.status} />
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12, position: 'relative',
      }}>
        <Mini label="Producten live" value={formatNumber(channel.counts.products)} />
        <Mini label="Orders" value={formatNumber(channel.counts.orders)} accent={channel.counts.orders > 0} />
        <Mini
          label="Credentials"
          value={
            channel.type === 'own_webshop'
              ? 'n.v.t.'
              : hasUsableCredentials
                ? 'Gezet'
                : '—'
          }
          muted={channel.type === 'own_webshop' ? true : !hasUsableCredentials}
        />
      </div>

      <div style={{
        fontSize: 12, lineHeight: 1.45, padding: '10px 12px',
        background: 'var(--surface-2)', borderRadius: 8,
        border: '1px solid var(--border-subtle)', color: 'var(--text-soft)',
        marginBottom: 12, position: 'relative',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
        }}>
          <span style={{ fontSize: 10.5, color: 'var(--theme-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Laatst gesynced
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-soft)' }}>
            {channel.lastSyncAt ? formatRelative(channel.lastSyncAt) : 'nog nooit'}
          </span>
        </div>
        {needsCredentials
          ? 'Credentials vereist om te activeren — klik op Configureren.'
          : channel.status === 'connected'
            ? 'Verbonden en klaar om te syncen.'
            : channel.status === 'error'
              ? 'Laatste verbindingstest mislukt — controleer credentials.'
              : 'Niet verbonden.'}
      </div>

      <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={onConfigure}
        >
          <SettingsIcon size={13} /> Configureren
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => void syncNow()}
          disabled={sync.isPending || needsCredentials}
          title={needsCredentials ? 'Credentials vereist om te activeren' : undefined}
        >
          <RefreshCcw size={13} className={sync.isPending ? 'spin' : ''} />
          {sync.isPending ? 'Syncen…' : 'Sync nu'}
        </button>
      </div>
    </div>
  );
}

function AddChannelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const TYPE_META: Record<ChannelType, { label: string; accent: string; letter: string; defaultName: string }> = {
    own_webshop: { label: 'Eigen webshop', accent: '#ff9f43', letter: 'W', defaultName: 'Eigen webshop' },
    bol: { label: 'Bol.com', accent: '#0000a4', letter: 'B', defaultName: 'Bol.com' },
    amazon: { label: 'Amazon', accent: '#ff9900', letter: 'A', defaultName: 'Amazon' },
    gmc: { label: 'Google Shopping', accent: '#4285f4', letter: 'G', defaultName: 'Google Shopping' },
  };

  const [channelType, setChannelType] = useState<ChannelType>('own_webshop');
  const [name, setName] = useState('Eigen webshop');
  const create = useCreateChannel();

  useEffect(() => {
    if (open) {
      setChannelType('own_webshop');
      setName('Eigen webshop');
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const finalName = name.trim() || TYPE_META[channelType].defaultName;
    try {
      await create.mutateAsync({ type: channelType, name: finalName });
      toast.success(
        `Kanaal ${finalName} toegevoegd — niet-verbonden. Configureer & activeer.`,
      );
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Aanmaken mislukt: ${e2.message}`);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Kanaal toevoegen"
      subtitle="Selecteer adapter-type en geef naam op."
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="add-channel-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Aanmaken…' : 'Kanaal aanmaken'}
          </button>
        </>
      }
    >
      <form id="add-channel-form" onSubmit={onSubmit}>
        <FormField label="Type">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {(Object.entries(TYPE_META) as Array<[ChannelType, typeof TYPE_META[ChannelType]]>).map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => { setChannelType(k); setName(v.defaultName); }}
                style={{
                  padding: '12px 10px',
                  background: channelType === k ? 'var(--theme-accent-subtle)' : 'var(--surface-2)',
                  border: channelType === k ? '1px solid var(--theme-accent-border)' : '1px solid var(--border-default)',
                  borderRadius: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: v.accent, color: '#fff',
                  display: 'grid', placeItems: 'center',
                  fontWeight: 700, fontSize: 12,
                }}>{v.letter}</div>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{v.label}</span>
              </button>
            ))}
          </div>
        </FormField>
        <FormField label="Naam" required>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder={TYPE_META[channelType].defaultName} />
        </FormField>
        <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-soft)', lineHeight: 1.5 }}>
          Het kanaal wordt aangemaakt als <strong>niet-verbonden</strong>. Klik vervolgens op "Configureren" om credentials in te voeren en te activeren.
        </div>
      </form>
    </Modal>
  );
}

function Mini({ label, value, muted, accent }: { label: string; value: string; muted?: boolean; accent?: boolean }) {
  return (
    <div style={{
      padding: '8px 10px',
      background: 'var(--surface-2)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 8,
    }}>
      <div style={{
        fontSize: 10, color: 'var(--theme-muted)', textTransform: 'uppercase',
        letterSpacing: '0.05em', fontWeight: 600,
      }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 700, marginTop: 2,
        color: accent ? 'var(--theme-accent)' : muted ? 'var(--theme-muted)' : 'var(--text-strong)',
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'connected') return <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />;
  if (status === 'error') return <ServerCrash size={18} style={{ color: 'var(--danger)' }} />;
  if (status === 'disconnected') return <CircleDashed size={18} style={{ color: 'var(--theme-muted)' }} />;
  return <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />;
}
