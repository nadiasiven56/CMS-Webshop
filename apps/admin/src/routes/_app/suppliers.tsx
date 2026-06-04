/**
 * /suppliers — leveranciers-beheer op de echte API (`/api/purchasing/suppliers`).
 *
 * Lijst (cards) + zoek + actief-filter, create/edit via drawer, delete via
 * confirm (soft-delete → active=false; backend blokkeert hard-delete bij
 * openstaande PO's). Purchasing is niet shop-scoped.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Mail, Phone, MapPin, Clock, Edit3, Search, Truck,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SupplierDrawer } from '@/components/purchasing/SupplierDrawer';
import { countryFlag } from '@/lib/format';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import {
  useSupplierList,
  useDeleteSupplier,
  type Supplier,
} from '@/components/purchasing/api';

export const Route = createFileRoute('/_app/suppliers')({
  component: SuppliersPage,
});

const ACTIVE_TABS: Array<{ value: 'all' | 'active' | 'inactive'; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'active', label: 'Actief' },
  { value: 'inactive', label: 'Inactief' },
];

function SuppliersPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'inactive'>('all');

  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Supplier | null>(null);

  const deleteMut = useDeleteSupplier();

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = useMemo(
    () => ({
      limit: 100,
      offset: 0,
      search: search || undefined,
      active: activeTab === 'all' ? undefined : activeTab === 'active',
    }),
    [search, activeTab],
  );

  const query = useSupplierList(params);
  const suppliers = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  async function handleDelete(s: Supplier) {
    try {
      await deleteMut.mutateAsync({ id: s.id });
      toast.success(`${s.name} gedeactiveerd`);
      setEditing(null);
    } catch (err) {
      const e = asApiError(err);
      toast.error(e.message || 'Verwijderen mislukt');
    }
  }

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Leveranciers</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">Inkoop-relaties — contactgegevens, lead-times en valuta.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={15} strokeWidth={2.2} />
          Leverancier toevoegen
        </button>
      </header>

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div className="search-input">
          <Search size={14} />
          <input
            aria-label="Zoek leveranciers"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Zoek op naam…"
          />
        </div>
        <div className="segmented" role="tablist" aria-label="Status">
          {ACTIVE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              data-active={activeTab === t.value}
              onClick={() => setActiveTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text" style={{ margin: 0 }}>
            Kon leveranciers niet laden: {asApiError(query.error).message}
          </p>
        </div>
      ) : query.isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={210} />)}
        </div>
      ) : suppliers.length === 0 ? (
        <EmptyState
          icon={search || activeTab !== 'all' ? Search : Truck}
          title={search || activeTab !== 'all' ? 'Geen leveranciers gevonden' : 'Nog geen leveranciers'}
          description={
            search || activeTab !== 'all'
              ? 'Pas je zoekterm of filter aan.'
              : 'Voeg je eerste leverancier toe om inkooporders te kunnen plaatsen.'
          }
          action={
            !search && activeTab === 'all' ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> Leverancier toevoegen
              </button>
            ) : undefined
          }
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {suppliers.map((s) => (
            <button
              key={s.id}
              type="button"
              className="card"
              onClick={() => setEditing(s)}
              style={{
                opacity: s.active ? 1 : 0.62, position: 'relative', textAlign: 'left',
                cursor: 'pointer', border: '1px solid var(--border-default)', display: 'block',
              }}
            >
              <div className="card-header" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div
                    style={{
                      width: 44, height: 44, borderRadius: 10,
                      background: 'linear-gradient(135deg, var(--surface-3), var(--surface-4))',
                      border: '1px solid var(--border-default)', display: 'grid', placeItems: 'center',
                      color: 'var(--theme-accent)', fontWeight: 700, fontSize: 16, flexShrink: 0,
                    }}
                  >
                    {s.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <h2 className="card-title" style={{ marginBottom: 3 }}>{s.name}</h2>
                    <span
                      className="badge"
                      style={{
                        background: s.active ? 'var(--success-soft)' : 'var(--surface-3)',
                        color: s.active ? 'var(--success)' : 'var(--theme-muted)',
                      }}
                    >
                      {s.active ? 'Actief' : 'Inactief'}
                    </span>
                  </div>
                </div>
                <Edit3 size={14} style={{ color: 'var(--theme-muted)', flexShrink: 0 }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: 'var(--theme-muted)', marginBottom: 12 }}>
                {(s.address?.city || s.address?.country) && (
                  <Line icon={<MapPin size={12} />}>
                    {s.address?.country ? `${countryFlag(s.address.country)} ` : ''}
                    {[s.address?.city, s.address?.country].filter(Boolean).join(', ')}
                  </Line>
                )}
                {s.email && <Line icon={<Mail size={12} />}>{s.email}</Line>}
                {s.phone && <Line icon={<Phone size={12} />}>{s.phone}</Line>}
                <Line icon={<Clock size={12} />}>Lead-time: {s.leadTimeDays} dagen • {s.currency}</Line>
              </div>

              {s.notes && (
                <div
                  style={{
                    fontSize: 12, lineHeight: 1.45, padding: '8px 10px',
                    background: 'var(--surface-2)', borderRadius: 8,
                    border: '1px solid var(--border-subtle)', color: 'var(--text-soft)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {s.notes}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      <SupplierDrawer
        supplier={editing}
        creating={false}
        onClose={() => setEditing(null)}
        onRequestDelete={(s) => setConfirmDelete(s)}
      />
      <SupplierDrawer
        supplier={null}
        creating={creating}
        onClose={() => setCreating(false)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void handleDelete(confirmDelete); }}
        title="Leverancier deactiveren?"
        message={
          <>
            <strong>{confirmDelete?.name}</strong> wordt op inactief gezet en verdwijnt uit de keuze
            voor nieuwe PO's. Bestaande inkooporders blijven behouden.
          </>
        }
        confirmLabel="Deactiveer"
      />
    </div>
  );
}

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: 'var(--text-faint)', display: 'inline-grid', placeItems: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
    </div>
  );
}
