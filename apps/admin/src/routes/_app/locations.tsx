/**
 * /locations — voorraadlocaties op de ECHTE API.
 *
 * Vervangt de oude mock-state preview (useLocations/locationActions). Behoudt
 * de bestaande card-layout, KPI's, type-iconen, active-toggle en prio-volgorde.
 * Locaties zijn GLOBAL (niet shop-scoped). Create/edit via drawer → echte
 * mutaties; delete via ConfirmDialog. Loading/empty/error states.
 *
 * Verschillen t.o.v. mock: het echte DTO heeft geen totalSkus/totalQty/ownerNote
 * (die kwamen uit de mock). Adres is één jsonb-object (line1/postcode/city/country)
 * i.p.v. losse velden. Prio-herordening = PATCH op priority (geen reorder-endpoint).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Plus, MapPin, Warehouse, Truck, Cloud, Store, Package, Edit3, Power, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { countryFlag } from '@/lib/format';
import {
  useLocations,
  useCreateLocation,
  useUpdateLocation,
  useDeleteLocation,
  type LocationDto,
} from '@/components/locations/api';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';

export const Route = createFileRoute('/_app/locations')({
  component: LocationsPage,
});

const TYPE_META: Record<string, { label: string; icon: React.ComponentType<{ size?: number }>; color: string }> = {
  warehouse: { label: 'Warehouse', icon: Warehouse, color: 'var(--theme-accent)' },
  dropship: { label: 'Dropship', icon: Truck, color: 'var(--info)' },
  virtual: { label: 'Virtueel', icon: Cloud, color: 'var(--warning)' },
  store: { label: 'Showroom', icon: Store, color: 'var(--success)' },
  transit: { label: 'Transit', icon: Truck, color: 'var(--info)' },
};

function typeMeta(type: string) {
  return TYPE_META[type] ?? { label: type, icon: Package, color: 'var(--theme-muted)' };
}

function LocationsPage() {
  const query = useLocations();
  const updateMut = useUpdateLocation();
  const deleteMut = useDeleteLocation();

  const [edit, setEdit] = useState<LocationDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LocationDto | null>(null);

  const locations = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const activeCount = locations.filter((l) => l.active).length;
  const typeCount = new Set(locations.map((l) => l.type)).size;

  // Backend sorteert al op priority asc; defensief opnieuw sorteren voor display.
  const sortedLocations = [...locations].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  function toggleActive(loc: LocationDto) {
    updateMut.mutate(
      { id: loc.id, patch: { active: !loc.active } },
      {
        onSuccess: () => toast.success(`${loc.name} ${loc.active ? 'gedeactiveerd' : 'geactiveerd'}`),
        onError: (err) => toast.error(asApiError(err).message || 'Bijwerken mislukt'),
      },
    );
  }

  // Prio-herordening: wissel de priority-waarde met de buur (PATCH op beide).
  function swapPriority(idx: number, dir: -1 | 1) {
    const a = sortedLocations[idx];
    const b = sortedLocations[idx + dir];
    if (!a || !b) return;
    updateMut.mutate(
      { id: a.id, patch: { priority: b.priority } },
      {
        onSuccess: () => {
          updateMut.mutate(
            { id: b.id, patch: { priority: a.priority } },
            {
              onSuccess: () => toast.success(`${a.name} ${dir === -1 ? 'omhoog' : 'omlaag'} verplaatst`),
              onError: (err) => toast.error(asApiError(err).message || 'Herordenen mislukt'),
            },
          );
        },
        onError: (err) => toast.error(asApiError(err).message || 'Herordenen mislukt'),
      },
    );
  }

  function handleDelete(loc: LocationDto) {
    deleteMut.mutate(loc.id, {
      onSuccess: () => {
        toast.success(`Locatie ${loc.name} verwijderd`);
        setEdit(null);
        setConfirmDelete(null);
      },
      onError: (err) => {
        toast.error(asApiError(err).message || 'Verwijderen mislukt');
        setConfirmDelete(null);
      },
    });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Locaties</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">Magazijnen, dropship-leveranciers, virtuele locaties en showrooms.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={15} strokeWidth={2.2} />
          Nieuwe locatie
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <SimpleKpi label="Total locaties" value={String(total)} hint={`${activeCount} actief`} />
        <SimpleKpi label="Actieve locaties" value={String(activeCount)} hint="orders alloceerbaar" />
        <SimpleKpi label="Types" value={String(typeCount)} hint="warehouse, dropship, …" />
      </div>

      {/* Content */}
      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">Kon locaties niet laden. Controleer of de backend draait en probeer pagina-refresh.</p>
        </div>
      ) : query.isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} height={180} />
          ))}
        </div>
      ) : sortedLocations.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title="Nog geen locaties"
          description="Maak je eerste voorraadlocatie aan — een magazijn, dropship-leverancier, virtuele locatie of showroom."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> Nieuwe locatie
            </button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {sortedLocations.map((loc, idx) => {
            const meta = typeMeta(loc.type);
            const Icon = meta.icon;
            const addr = loc.address ?? {};
            const hasAddress = !!(addr.line1 || addr.postcode || addr.city);
            return (
              <div
                key={loc.id}
                className="card"
                style={{ opacity: loc.active ? 1 : 0.7, position: 'relative', cursor: 'pointer' }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return;
                  setEdit(loc);
                }}
              >
                <div className="card-header" style={{ alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 40, height: 40, borderRadius: 10,
                        background: 'var(--surface-3)',
                        border: `1px solid var(--border-default)`,
                        display: 'grid', placeItems: 'center',
                        color: meta.color,
                      }}
                    >
                      <Icon size={18} />
                    </div>
                    <div>
                      <h2 className="card-title" style={{ marginBottom: 2 }}>{loc.name}</h2>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--theme-muted)' }}>{loc.code}</span>
                        <span className="badge" style={{ background: 'transparent', borderColor: 'var(--border-default)' }}>
                          {meta.label}
                        </span>
                        <span className="badge badge-neutral">Prio {loc.priority}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleActive(loc);
                    }}
                    className="badge"
                    style={{
                      cursor: 'pointer',
                      border: 'none',
                      background: loc.active ? 'var(--success-soft)' : 'var(--surface-3)',
                      color: loc.active ? 'var(--success)' : 'var(--theme-muted)',
                    }}
                    title="Klik om te (de)activeren"
                  >
                    <Power size={11} /> {loc.active ? 'Actief' : 'Inactief'}
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--theme-muted)', marginBottom: 12 }}>
                  <MapPin size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                  {hasAddress ? (
                    <div>
                      {addr.line1 && <div>{addr.line1}</div>}
                      <div>
                        {[addr.postcode, addr.city].filter(Boolean).join(' ')}{' '}
                        {addr.country ? countryFlag(addr.country) : ''}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontStyle: 'italic' }}>Geen adres ingesteld</div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEdit(loc);
                    }}
                  >
                    <Edit3 size={13} /> Bewerken
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => { e.stopPropagation(); swapPriority(idx, -1); }}
                    disabled={idx === 0 || updateMut.isPending}
                    title="Prioriteit omhoog"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => { e.stopPropagation(); swapPriority(idx, 1); }}
                    disabled={idx >= sortedLocations.length - 1 || updateMut.isPending}
                    title="Prioriteit omlaag"
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LocationDrawer
        location={edit}
        onClose={() => setEdit(null)}
        onDelete={(l) => setConfirmDelete(l)}
      />
      <LocationDrawer
        location={createOpen ? null : undefined}
        creating={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) handleDelete(confirmDelete); }}
        title="Locatie verwijderen?"
        message={
          <><strong>{confirmDelete?.name}</strong> wordt definitief verwijderd. Let op: zorg dat er geen voorraad meer op deze locatie staat.</>
        }
        confirmLabel="Verwijder"
      />
    </div>
  );
}

function LocationDrawer({
  location,
  creating,
  onClose,
  onDelete,
}: {
  location?: LocationDto | null;
  creating?: boolean;
  onClose: () => void;
  onDelete?: (l: LocationDto) => void;
}) {
  const open = creating || location != null;
  const isCreate = !!creating;

  const createMut = useCreateLocation();
  const updateMut = useUpdateLocation();
  const saving = createMut.isPending || updateMut.isPending;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState('warehouse');
  const [priority, setPriority] = useState(100);
  const [active, setActive] = useState(true);
  const [line1, setLine1] = useState('');
  const [postcode, setPostcode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('NL');

  useEffect(() => {
    if (open) {
      if (location) {
        const addr = location.address ?? {};
        setName(location.name);
        setCode(location.code);
        setType(location.type);
        setPriority(location.priority);
        setActive(location.active);
        setLine1(addr.line1 ?? '');
        setPostcode(addr.postcode ?? '');
        setCity(addr.city ?? '');
        setCountry(addr.country ?? 'NL');
      } else {
        setName(''); setCode(''); setType('warehouse'); setPriority(100);
        setActive(true);
        setLine1(''); setPostcode(''); setCity(''); setCountry('NL');
      }
    }
  }, [open, location]);

  function buildAddress() {
    const addr: Record<string, string> = {};
    if (line1.trim()) addr.line1 = line1.trim();
    if (postcode.trim()) addr.postcode = postcode.trim();
    if (city.trim()) addr.city = city.trim();
    if (country.trim()) addr.country = country.trim();
    return Object.keys(addr).length > 0 ? addr : null;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) {
      toast.error('Naam en code zijn verplicht');
      return;
    }
    const address = buildAddress();

    if (isCreate) {
      createMut.mutate(
        { code: code.trim(), name: name.trim(), type, priority, active, address },
        {
          onSuccess: () => {
            toast.success(`Locatie ${name.trim()} aangemaakt`);
            onClose();
          },
          onError: (err) => {
            const e2 = asApiError(err);
            toast.error(e2.code === 'code_taken' ? `Code "${code.trim()}" is al in gebruik` : e2.message || 'Aanmaken mislukt');
          },
        },
      );
    } else if (location) {
      updateMut.mutate(
        { id: location.id, patch: { code: code.trim(), name: name.trim(), type, priority, active, address } },
        {
          onSuccess: () => {
            toast.success(`Locatie ${name.trim()} bijgewerkt`);
            onClose();
          },
          onError: (err) => {
            const e2 = asApiError(err);
            toast.error(e2.code === 'code_taken' ? `Code "${code.trim()}" is al in gebruik` : e2.message || 'Opslaan mislukt');
          },
        },
      );
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isCreate ? 'Nieuwe locatie' : location?.name}
      subtitle={isCreate ? 'Magazijn, dropship of virtuele locatie.' : location?.code}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          {!isCreate && location && onDelete && (
            <button type="button" className="btn btn-danger" onClick={() => onDelete(location)}>
              <Trash2 size={13} /> Verwijder
            </button>
          )}
          <button type="submit" form="loc-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Bezig…' : isCreate ? 'Aanmaken' : 'Opslaan'}
          </button>
        </>
      }
    >
      <form id="loc-form" onSubmit={onSubmit}>
        <FormField label="Naam" required>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormField label="Code" required hint="Uniek, bv. wh-nl">
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="wh-001" />
          </FormField>
          <FormField label="Prioriteit" hint="Lager = eerst alloceren">
            <input type="number" min={0} max={1000000} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
          </FormField>
        </div>
        <FormField label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="warehouse">Warehouse</option>
            <option value="dropship">Dropship</option>
            <option value="virtual">Virtueel</option>
            <option value="store">Showroom</option>
            <option value="transit">Transit</option>
          </select>
        </FormField>
        <FormField label="Straat + huisnr">
          <input type="text" value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Voorbeeldstraat 12" />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 100px', gap: 8 }}>
          <FormField label="Postcode">
            <input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="1234 AB" />
          </FormField>
          <FormField label="Plaats">
            <input type="text" value={city} onChange={(e) => setCity(e.target.value)} />
          </FormField>
          <FormField label="Land">
            <select value={country} onChange={(e) => setCountry(e.target.value)}>
              <option>NL</option><option>BE</option><option>DE</option><option>FR</option>
              <option>IT</option><option>ES</option>
            </select>
          </FormField>
        </div>
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, color: 'var(--theme-text)',
            padding: '10px 12px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            marginTop: 8,
          }}
        >
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 16, height: 16, padding: 0 }} />
          <span>Locatie actief — orders kunnen gealloceerd worden</span>
        </label>
      </form>
    </Drawer>
  );
}

function SimpleKpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi-card">
      <span className="kpi-label">{label}</span>
      <h2 className="kpi-value">{value}</h2>
      {hint && <p className="kpi-hint">{hint}</p>}
    </div>
  );
}
