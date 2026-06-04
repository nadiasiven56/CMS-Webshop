/**
 * /accounting/koppelingen — Boekhoud-koppeling op de ECHTE API (`/api/accounting`).
 *
 * Per koppeling (Moneybird / Exact Online / e-Boekhouden) een card met echte
 * status, sync-log-counts en laatste sync. "Configureren" opent de drawer
 * (per-provider creds + config + onboarding-help + test + synchroniseren),
 * "Synchroniseren" roept de echte sync-endpoint. Onderaan een sync-log-tabel
 * van de geselecteerde koppeling.
 *
 * Child-route van /accounting (layout = pure <Outlet/>).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Plus,
  Settings as SettingsIcon,
  RefreshCcw,
  Receipt,
  CheckCircle2,
  CircleDashed,
  ServerCrash,
  ScrollText,
} from 'lucide-react';
import { AccountingStatusPill } from '@/components/accounting/AccountingStatusPill';
import { AccountingConfigDrawer } from '@/components/accounting/AccountingConfigDrawer';
import { SyncLogTable } from '@/components/accounting/SyncLogTable';
import {
  useConnections,
  useCreateConnection,
  useSyncConnection,
  providerMeta,
  ACCOUNTING_PROVIDERS,
  type AccountingConnectionDetailDto,
  type AccountingProvider,
} from '@/components/accounting/api';
import { formatRelative, formatNumber } from '@/lib/format';
import { asApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/accounting/koppelingen')({
  component: AccountingPage,
});

function AccountingPage() {
  const query = useConnections();
  const [config, setConfig] = useState<AccountingConnectionDetailDto | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);

  const connections = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  // Houd de geopende drawer-connectie in sync met verse data na invalidatie.
  useEffect(() => {
    if (!config) return;
    const fresh = connections.find((c) => c.id === config.id);
    if (fresh && fresh !== config) setConfig(fresh);
  }, [connections]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default-selectie voor de sync-log = eerste koppeling.
  useEffect(() => {
    if (selectedLog && connections.some((c) => c.id === selectedLog)) return;
    setSelectedLog(connections[0]?.id ?? null);
  }, [connections]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedConnection = connections.find((c) => c.id === selectedLog) ?? null;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Boekhoud-koppeling</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">
            Push facturen en orders naar je boekhoudpakket — Moneybird, Exact Online of
            e-Boekhouden.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
          <Plus size={15} strokeWidth={2.2} />
          Koppeling toevoegen
        </button>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">
            Kon koppelingen niet laden. Controleer of de backend draait en probeer
            pagina-refresh.
          </p>
        </div>
      ) : query.isLoading ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 16,
          }}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} height={240} />
          ))}
        </div>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nog geen boekhoud-koppeling"
          description="Voeg een koppeling toe — Moneybird, Exact Online of e-Boekhouden."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> Koppeling toevoegen
            </button>
          }
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 16,
          }}
        >
          {connections.map((c) => (
            <ConnectionCard
              key={c.id}
              connection={c}
              active={c.id === selectedLog}
              onConfigure={() => setConfig(c)}
              onSelect={() => setSelectedLog(c.id)}
            />
          ))}

          {/* Add new card */}
          <button
            type="button"
            className="card"
            onClick={() => setAddOpen(true)}
            style={{
              border: '1px dashed var(--border-default)',
              background: 'transparent',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 240,
              cursor: 'pointer',
              color: 'var(--theme-muted)',
              padding: 24,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'var(--surface-3)',
                border: '1px solid var(--border-default)',
                display: 'grid',
                placeItems: 'center',
                marginBottom: 12,
                color: 'var(--theme-accent)',
              }}
            >
              <Plus size={20} strokeWidth={2.4} />
            </div>
            <div style={{ fontWeight: 600, color: 'var(--theme-text)', marginBottom: 4 }}>
              Voeg koppeling toe
            </div>
            <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 240 }}>
              Connect Moneybird, Exact Online of e-Boekhouden.
            </div>
          </button>
        </div>
      )}

      {/* Sync-log van de geselecteerde koppeling */}
      {connections.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <h2 className="card-title" style={{ marginRight: 'auto' }}>
              <ScrollText size={14} style={{ display: 'inline', verticalAlign: -2 }} />{' '}
              Sync-historie
            </h2>
            <select
              value={selectedLog ?? ''}
              onChange={(e) => setSelectedLog(e.target.value)}
              style={{ padding: '7px 10px', fontSize: 13 }}
              aria-label="Koppeling voor sync-historie"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {selectedConnection ? (
            <SyncLogTable key={selectedConnection.id} connectionId={selectedConnection.id} />
          ) : null}
        </div>
      )}

      <AccountingConfigDrawer connection={config} onClose={() => setConfig(null)} />
      <AddConnectionModal open={addOpen} onClose={() => setAddOpen(false)} />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
}

function ConnectionCard({
  connection,
  active,
  onConfigure,
  onSelect,
}: {
  connection: AccountingConnectionDetailDto;
  active: boolean;
  onConfigure: () => void;
  onSelect: () => void;
}) {
  const meta = providerMeta(connection.provider);
  const sync = useSyncConnection(connection.id);
  const hasUsableCredentials =
    connection.hasCredentials &&
    Object.keys(connection.credentials ?? {}).length > 0;
  const needsCredentials = !hasUsableCredentials;

  async function syncNow() {
    try {
      const res = await sync.mutateAsync({ scope: 'invoices' });
      if (res.errors.length > 0) {
        toast.error(`${connection.name}: gesynced met ${res.errors.length} fout(en)`);
      } else {
        toast.success(
          `${connection.name}: ${res.pushed} gepusht, ${res.skipped} overgeslagen`,
        );
      }
    } catch (err) {
      const e2 = asApiError(err);
      if (e2.code === 'accounting_not_connected') {
        toast.error(`${connection.name} is niet verbonden — configureer credentials eerst.`);
      } else {
        toast.error(`Synchronisatie mislukt: ${e2.message}`);
      }
    }
  }

  return (
    <div
      className="card"
      onClick={onSelect}
      style={{
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: active ? '0 0 0 1px var(--theme-accent-border)' : undefined,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at top right, ${meta.accent}10, transparent 60%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        className="card-header"
        style={{ alignItems: 'flex-start', position: 'relative' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 11,
              background: meta.accent,
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 20,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              flexShrink: 0,
            }}
          >
            {meta.letter}
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 className="card-title" style={{ marginBottom: 3 }}>
              {connection.name}
            </h2>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>
                {meta.kind}
              </span>
              <AccountingStatusPill status={connection.status} />
            </div>
          </div>
        </div>
        <StatusIcon status={connection.status} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          marginBottom: 12,
          position: 'relative',
        }}
      >
        <Mini label="Gesynct" value={formatNumber(connection.counts.synced)} />
        <Mini
          label="Fouten"
          value={formatNumber(connection.counts.errors)}
          danger={connection.counts.errors > 0}
        />
        <Mini
          label="Credentials"
          value={hasUsableCredentials ? 'Gezet' : 'Niet gezet'}
          muted={!hasUsableCredentials}
        />
      </div>

      <div
        style={{
          fontSize: 12,
          lineHeight: 1.45,
          padding: '10px 12px',
          background: 'var(--surface-2)',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-soft)',
          marginBottom: 12,
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              color: 'var(--theme-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
            }}
          >
            Laatst gesynced
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-soft)' }}>
            {connection.lastSyncAt ? formatRelative(connection.lastSyncAt) : 'nog nooit'}
          </span>
        </div>
        {needsCredentials
          ? 'Credentials vereist om te activeren — klik op Configureren.'
          : connection.status === 'connected'
            ? 'Verbonden en klaar om te synchroniseren.'
            : connection.status === 'error'
              ? 'Laatste verbindingstest mislukt — controleer credentials.'
              : 'Niet verbonden.'}
      </div>

      <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={(e) => {
            e.stopPropagation();
            onConfigure();
          }}
        >
          <SettingsIcon size={13} /> Configureren
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={(e) => {
            e.stopPropagation();
            void syncNow();
          }}
          disabled={sync.isPending || connection.status !== 'connected'}
          title={
            connection.status !== 'connected'
              ? 'Verbind eerst (credentials + test) om te synchroniseren'
              : undefined
          }
        >
          <RefreshCcw size={13} className={sync.isPending ? 'spin' : ''} />
          {sync.isPending ? 'Synchroniseren…' : 'Synchroniseren'}
        </button>
      </div>
    </div>
  );
}

function AddConnectionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [provider, setProvider] = useState<AccountingProvider>('moneybird');
  const [name, setName] = useState(providerMeta('moneybird').label);
  const create = useCreateConnection();

  useEffect(() => {
    if (open) {
      setProvider('moneybird');
      setName(providerMeta('moneybird').label);
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const finalName = name.trim() || providerMeta(provider).label;
    try {
      await create.mutateAsync({ provider, name: finalName });
      toast.success(
        `Koppeling ${finalName} toegevoegd — niet-verbonden. Configureer & activeer.`,
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
      title="Koppeling toevoegen"
      subtitle="Selecteer een boekhoudpakket en geef de koppeling een naam."
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleer
          </button>
          <button
            type="submit"
            form="add-connection-form"
            className="btn btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? 'Aanmaken…' : 'Koppeling aanmaken'}
          </button>
        </>
      }
    >
      <form id="add-connection-form" onSubmit={onSubmit}>
        <FormField label="Provider">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 8,
            }}
          >
            {ACCOUNTING_PROVIDERS.map((p) => {
              const v = providerMeta(p);
              const activeP = provider === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setProvider(p);
                    setName(v.label);
                  }}
                  style={{
                    padding: '12px 10px',
                    background: activeP
                      ? 'var(--theme-accent-subtle)'
                      : 'var(--surface-2)',
                    border: activeP
                      ? '1px solid var(--theme-accent-border)'
                      : '1px solid var(--border-default)',
                    borderRadius: 10,
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      background: v.accent,
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    {v.letter}
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{v.label}</span>
                </button>
              );
            })}
          </div>
        </FormField>
        <FormField label="Naam" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder={providerMeta(provider).label}
          />
        </FormField>
        <div
          style={{
            padding: 10,
            background: 'var(--surface-2)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--text-soft)',
            lineHeight: 1.5,
          }}
        >
          De koppeling wordt aangemaakt als <strong>niet-verbonden</strong>. Klik daarna op
          "Configureren" om credentials in te voeren en te activeren.
        </div>
      </form>
    </Modal>
  );
}

function Mini({
  label,
  value,
  muted,
  danger,
}: {
  label: string;
  value: string;
  muted?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      style={{
        padding: '8px 10px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--theme-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          marginTop: 2,
          color: danger
            ? 'var(--danger)'
            : muted
              ? 'var(--theme-muted)'
              : 'var(--text-strong)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'connected')
    return <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />;
  if (status === 'error')
    return <ServerCrash size={18} style={{ color: 'var(--danger)' }} />;
  return <CircleDashed size={18} style={{ color: 'var(--theme-muted)' }} />;
}
