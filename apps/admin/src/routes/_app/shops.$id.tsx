/**
 * /shops/:id — shop-detail / edit + product-publicatie-matrix.
 *
 * - Header met naam/slug/status + "Bewerken" (opent ShopDrawer in edit-modus).
 * - Overzichtskaarten: algemeen (domein/locale/currency), branding, BTW-config.
 * - ProductPublicationMatrix: toggle published + price_override + position.
 * - Delete via ConfirmDialog (secundaire actie, ook in de edit-drawer).
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft, Globe, Pencil, Store } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastBus } from '@/components/ui/Toast';
import { asApiError } from '@/lib/api';
import { ShopStatusBadge } from '@/components/shops/ShopStatusBadge';
import { ShopDrawer, valuesToPayload } from '@/components/shops/ShopDrawer';
import { ProductPublicationMatrix } from '@/components/shops/ProductPublicationMatrix';
import { ConnectPanel } from '@/components/shops/ConnectPanel';
import { PaymentsPanel } from '@/components/shops/PaymentsPanel';
import {
  useShopDetail,
  useUpdateShop,
  useDeleteShop,
} from '@/components/shops/api';

export const Route = createFileRoute('/_app/shops/$id')({
  component: ShopDetailPage,
});

function ShopDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const detail = useShopDetail(id);
  const update = useUpdateShop(id);
  const del = useDeleteShop();

  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const shop = detail.data;

  function handleSave(payload: ReturnType<typeof valuesToPayload>) {
    update.mutate(payload, {
      onSuccess: (s) => {
        toastBus.push('success', `"${s.name}" opgeslagen`);
        setEditOpen(false);
      },
      onError: (err) => {
        const e = asApiError(err);
        const msg =
          e.code === 'slug_taken'
            ? 'Die slug is al in gebruik'
            : e.code === 'domain_taken'
              ? 'Dat domein is al in gebruik'
              : e.message || 'Opslaan mislukt';
        toastBus.push('error', msg);
      },
    });
  }

  function handleDelete() {
    del.mutate(id, {
      onSuccess: () => {
        toastBus.push('success', 'Shop verwijderd');
        void navigate({ to: '/shops' });
      },
      onError: (err) => {
        toastBus.push('error', asApiError(err).message || 'Verwijderen mislukt');
      },
    });
  }

  if (detail.isLoading) {
    return (
      <div>
        <Skeleton width={180} height={14} />
        <div style={{ marginTop: 16 }}>
          <Skeleton height={80} />
        </div>
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <Skeleton height={140} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      </div>
    );
  }

  if (detail.isError || !shop) {
    return (
      <div className="empty-state">
        <h2>Shop niet gevonden</h2>
        <p>De shop is mogelijk verwijderd of het id klopt niet.</p>
        <Link to="/shops" className="btn btn-secondary" style={{ marginTop: 12 }}>
          Terug naar shops
        </Link>
      </div>
    );
  }

  const b = shop.branding ?? {};
  const v = shop.vatConfig ?? {};
  const primaryColor = typeof b.primaryColor === 'string' ? b.primaryColor : null;
  const accentColor = typeof b.accentColor === 'string' ? b.accentColor : null;

  return (
    <div>
      <Link
        to="/shops"
        className="muted"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, marginBottom: 14 }}
      >
        <ArrowLeft size={14} />
        Shops
      </Link>

      <header className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: 46,
              height: 46,
              borderRadius: 11,
              background: primaryColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(primaryColor) ? primaryColor : 'var(--theme-accent)',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              flexShrink: 0,
            }}
          >
            <Store size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="page-title-row" style={{ gap: 10 }}>
              <h1 className="page-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{shop.name}</h1>
              <ShopStatusBadge status={shop.status} />
            </div>
            <p className="page-subtitle">/{shop.slug}</p>
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-icon-leading" onClick={() => setEditOpen(true)}>
          <Pencil size={14} />
          Bewerken
        </button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div className="card">
          <div className="muted" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
            Algemeen
          </div>
          <DetailRow label="Domein" value={shop.domain ?? '—'} icon={<Globe size={13} />} />
          <DetailRow label="Taal" value={shop.locale} />
          <DetailRow label="Valuta" value={shop.currency} />
          {shop.supportEmail && <DetailRow label="Support" value={shop.supportEmail} />}
        </div>

        <div className="card">
          <div className="muted" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
            Branding
          </div>
          <ColorRow label="Primair" color={primaryColor} />
          <ColorRow label="Accent" color={accentColor} />
          {typeof b.logoUrl === 'string' && b.logoUrl && (
            <DetailRow label="Logo" value={b.logoUrl} />
          )}
          {!primaryColor && !accentColor && !b.logoUrl && (
            <div className="muted" style={{ fontSize: 12.5 }}>Geen branding ingesteld.</div>
          )}
        </div>

        <div className="card">
          <div className="muted" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
            BTW-configuratie
          </div>
          <DetailRow label="Prijzen incl. BTW" value={v.priceIncludesVat === false ? 'Nee' : 'Ja'} />
          <DetailRow label="OSS" value={v.oss ? 'Aan' : 'Uit'} />
          {typeof v.defaultCountry === 'string' && v.defaultCountry && (
            <DetailRow label="Standaard land" value={v.defaultCountry} />
          )}
        </div>
      </div>

      <ConnectPanel shop={shop} />

      <PaymentsPanel shop={shop} />

      <div style={{ marginTop: 24 }}>
        <ProductPublicationMatrix shopId={id} currency={shop.currency} />
      </div>

      <ShopDrawer
        open={editOpen}
        mode="edit"
        initial={shop}
        saving={update.isPending}
        onClose={() => setEditOpen(false)}
        onSubmit={handleSave}
        onDelete={() => {
          setEditOpen(false);
          setConfirmDelete(true);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Shop verwijderen?"
        message={`"${shop.name}" en alle bijbehorende publicaties worden permanent verwijderd. Dit kan niet ongedaan worden.`}
        confirmLabel="Verwijderen"
        variant="danger"
      />
    </div>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 12.5 }}>
      <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {icon}
        {label}
      </span>
      <span style={{ color: 'var(--theme-text)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
        {value}
      </span>
    </div>
  );
}

function ColorRow({ label, color }: { label: string; color: string | null }) {
  const valid = !!color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 12.5 }}>
      <span className="muted">{label}</span>
      {valid ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden style={{ width: 16, height: 16, borderRadius: 5, background: color!, border: '1px solid var(--border-default)' }} />
          <span style={{ color: 'var(--theme-text)' }}>{color}</span>
        </span>
      ) : (
        <span className="muted">—</span>
      )}
    </div>
  );
}
