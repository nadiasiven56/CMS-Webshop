/**
 * /shipping (index) — verzending op de ECHTE API (`/api/shipping`).
 *
 * Vervoerders-beheer (sendcloud/myparcel/postnl/dhl): per carrier een card met
 * echte status, shipment-count en laatste verbindingstest. "Configureren" opent
 * de drawer (credentials/config + Test verbinding + onboarding-help). Daaronder
 * een sectie met recente shipments incl. tracking-link.
 *
 * UX/look spiegelt channels.index.tsx — alleen het domein is verzending.
 *
 * NB: dit is de INDEX-route van het shipping-layout (shipping.tsx). De layout
 * rendert enkel <Outlet/>; deze index toont de inhoud op /shipping.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Plus, Settings as SettingsIcon, Truck, Package,
  CheckCircle2, CircleDashed, ServerCrash, ExternalLink, Loader2,
} from 'lucide-react';
import { CarrierStatusPill, ShipmentStatusPill } from '@/components/shipping/CarrierStatusPill';
import { CarrierConfigDrawer } from '@/components/shipping/CarrierConfigDrawer';
import {
  useCarriers,
  useCreateCarrier,
  useShipments,
  useShipmentTracking,
  carrierMeta,
  type CarrierDetailDto,
  type CarrierCode,
  type ShipmentDto,
} from '@/components/shipping/api';
import { formatRelative, formatNumber, formatDateTime } from '@/lib/format';
import { asApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard, SkeletonTableRows } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/shipping/')({
  component: ShippingPage,
});

function ShippingPage() {
  const query = useCarriers();
  const [config, setConfig] = useState<CarrierDetailDto | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const carriers = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  // Houd de geopende drawer-carrier in sync met verse data na invalidatie.
  useEffect(() => {
    if (!config) return;
    const fresh = carriers.find((c) => c.id === config.id);
    if (fresh && fresh !== config) setConfig(fresh);
  }, [carriers]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Verzending</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">
            Vervoerders koppelen, labels maken en zendingen volgen — Sendcloud, MyParcel, PostNL, DHL.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
            <Plus size={15} strokeWidth={2.2} />
            Vervoerder toevoegen
          </button>
        </div>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">
            Kon vervoerders niet laden. Controleer of de backend draait en probeer pagina-refresh.
          </p>
        </div>
      ) : query.isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} height={240} />
          ))}
        </div>
      ) : carriers.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Nog geen vervoerders"
          description="Voeg een vervoerder toe — Sendcloud, MyParcel, PostNL of DHL — om labels te maken en zendingen te volgen."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> Vervoerder toevoegen
            </button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
          {carriers.map((c) => (
            <CarrierCard key={c.id} carrier={c} onConfigure={() => setConfig(c)} />
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
              minHeight: 240, cursor: 'pointer', color: 'var(--theme-muted)',
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
              Voeg vervoerder toe
            </div>
            <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 240 }}>
              Koppel Sendcloud, MyParcel, PostNL of DHL.
            </div>
          </button>
        </div>
      )}

      <ShipmentsSection />

      <CarrierConfigDrawer carrier={config} onClose={() => setConfig(null)} />
      <AddCarrierModal open={addOpen} onClose={() => setAddOpen(false)} existing={carriers.map((c) => c.code)} />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
}

function CarrierCard({
  carrier,
  onConfigure,
}: {
  carrier: CarrierDetailDto;
  onConfigure: () => void;
}) {
  const meta = carrierMeta(carrier.code);
  // 'Gezet' alleen als de backend zegt dat er creds zijn ÉN de masked map velden
  // bevat (lege {} telt NIET — zie channels-card-rationale).
  const hasUsableCredentials =
    carrier.hasCredentials && Object.keys(carrier.credentials ?? {}).length > 0;
  const needsCredentials = carrier.code !== 'dhl' && !hasUsableCredentials;

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
            <h2 className="card-title" style={{ marginBottom: 3 }}>{carrier.name}</h2>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>{meta.kind}</span>
              <CarrierStatusPill status={carrier.status} />
            </div>
          </div>
        </div>
        <StatusIcon status={carrier.status} />
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12, position: 'relative',
      }}>
        <Mini label="Zendingen" value={formatNumber(carrier.counts.shipments)} accent={carrier.counts.shipments > 0} />
        <Mini
          label="Credentials"
          value={
            carrier.code === 'dhl'
              ? 'n.v.t.'
              : hasUsableCredentials
                ? 'Gezet'
                : '—'
          }
          muted={carrier.code === 'dhl' ? true : !hasUsableCredentials}
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
            Laatste test
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-soft)' }}>
            {carrier.lastTestAt ? formatRelative(carrier.lastTestAt) : 'nog nooit'}
          </span>
        </div>
        {carrier.code === 'dhl'
          ? 'Koppeling voor DHL komt later — adapter nog niet beschikbaar.'
          : needsCredentials
            ? 'Credentials vereist om te activeren — klik op Configureren.'
            : carrier.status === 'connected'
              ? 'Verbonden en klaar om labels te maken.'
              : carrier.status === 'error'
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
      </div>
    </div>
  );
}

function AddCarrierModal({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing: string[];
}) {
  // Eerste nog-niet-aangemaakte code als default.
  const allCodes: CarrierCode[] = ['sendcloud', 'myparcel', 'postnl', 'dhl'];
  const firstFree = allCodes.find((c) => !existing.includes(c)) ?? 'sendcloud';

  const [code, setCode] = useState<CarrierCode>(firstFree);
  const [name, setName] = useState(carrierMeta(firstFree).label);
  const create = useCreateCarrier();

  useEffect(() => {
    if (open) {
      const free = allCodes.find((c) => !existing.includes(c)) ?? 'sendcloud';
      setCode(free);
      setName(carrierMeta(free).label);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const finalName = name.trim() || carrierMeta(code).label;
    try {
      await create.mutateAsync({ code, name: finalName });
      toast.success(
        `Vervoerder ${finalName} toegevoegd — niet-verbonden. Configureer & activeer.`,
      );
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      if (e2.code === 'carrier_code_exists') {
        toast.error(`Er bestaat al een ${carrierMeta(code).label}-vervoerder.`);
      } else {
        toast.error(`Aanmaken mislukt: ${e2.message}`);
      }
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Vervoerder toevoegen"
      subtitle="Selecteer een vervoerder en geef een naam op."
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="add-carrier-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Aanmaken…' : 'Vervoerder aanmaken'}
          </button>
        </>
      }
    >
      <form id="add-carrier-form" onSubmit={onSubmit}>
        <FormField label="Vervoerder">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {allCodes.map((k) => {
              const v = carrierMeta(k);
              const taken = existing.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  disabled={taken}
                  onClick={() => { setCode(k); setName(v.label); }}
                  title={taken ? 'Al toegevoegd' : undefined}
                  style={{
                    padding: '12px 10px',
                    background: code === k ? 'var(--theme-accent-subtle)' : 'var(--surface-2)',
                    border: code === k ? '1px solid var(--theme-accent-border)' : '1px solid var(--border-default)',
                    borderRadius: 10,
                    cursor: taken ? 'not-allowed' : 'pointer',
                    opacity: taken ? 0.5 : 1,
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
              );
            })}
          </div>
        </FormField>
        <FormField label="Naam" required>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder={carrierMeta(code).label} />
        </FormField>
        <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-soft)', lineHeight: 1.5 }}>
          De vervoerder wordt aangemaakt als <strong>niet-verbonden</strong>. Klik daarna op
          "Configureren" om credentials in te voeren en te activeren.
        </div>
      </form>
    </Modal>
  );
}

// ─── Recent shipments-sectie ───────────────────────────────────

function ShipmentsSection() {
  const query = useShipments({ limit: 25 });
  const shipments = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Package size={16} style={{ color: 'var(--theme-accent)' }} />
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Recente zendingen</h2>
        <span className="count-badge">{total}</span>
      </div>

      {query.isError ? (
        <div className="card">
          <p className="error-text">Kon zendingen niet laden.</p>
        </div>
      ) : query.isLoading ? (
        <SkeletonTableRows rows={4} />
      ) : shipments.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nog geen zendingen"
          description="Zodra je via een gekoppelde vervoerder een label aanmaakt, verschijnt de zending hier met tracking."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Vervoerder</th>
                <th>Tracking</th>
                <th>Status</th>
                <th>Gewicht</th>
                <th>Aangemaakt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <ShipmentRow key={s.id} shipment={s} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ShipmentRow({ shipment }: { shipment: ShipmentDto }) {
  const meta = shipment.carrierCode ? carrierMeta(shipment.carrierCode) : null;
  const tracking = useShipmentTracking(shipment.id);

  async function refreshTracking() {
    try {
      const res = await tracking.mutateAsync();
      toast.success(`Tracking: ${res.carrierStatus} (${res.events.length} event(s))`);
    } catch (err) {
      const e2 = asApiError(err);
      if (e2.code === 'no_tracking_code') {
        toast.error('Deze zending heeft nog geen tracking-code.');
      } else if (e2.code === 'carrier_not_connected') {
        toast.error('Vervoerder is niet verbonden — configureer credentials eerst.');
      } else {
        toast.error(`Tracking ophalen mislukt: ${e2.message}`);
      }
    }
  }

  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {meta && (
            <div style={{
              width: 24, height: 24, borderRadius: 6,
              background: meta.accent, color: '#fff',
              display: 'grid', placeItems: 'center',
              fontWeight: 700, fontSize: 11, flexShrink: 0,
            }}>{meta.letter}</div>
          )}
          <span style={{ fontSize: 12.5 }}>{meta?.label ?? shipment.carrierCode ?? '—'}</span>
        </div>
      </td>
      <td>
        {shipment.trackingCode ? (
          shipment.trackingUrl ? (
            <a
              href={shipment.trackingUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--theme-accent)' }}
            >
              <code style={{ fontSize: 12 }}>{shipment.trackingCode}</code>
              <ExternalLink size={12} />
            </a>
          ) : (
            <code style={{ fontSize: 12 }}>{shipment.trackingCode}</code>
          )
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>—</span>
        )}
      </td>
      <td><ShipmentStatusPill status={shipment.status} /></td>
      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
        {shipment.weightGrams != null ? `${formatNumber(shipment.weightGrams)} g` : '—'}
      </td>
      <td style={{ fontSize: 12, color: 'var(--text-soft)' }}>{formatDateTime(shipment.createdAt)}</td>
      <td style={{ textAlign: 'right' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void refreshTracking()}
          disabled={tracking.isPending || !shipment.trackingCode}
          title={shipment.trackingCode ? 'Tracking-status ophalen' : 'Geen tracking-code'}
        >
          {tracking.isPending ? <Loader2 size={13} className="spin" /> : null}
          {tracking.isPending ? 'Ophalen…' : 'Tracking'}
        </button>
      </td>
    </tr>
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
  return <CircleDashed size={18} style={{ color: 'var(--theme-muted)' }} />;
}
