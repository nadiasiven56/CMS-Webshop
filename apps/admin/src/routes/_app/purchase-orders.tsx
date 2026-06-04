/**
 * /purchase-orders — inkooporders op de echte API (`/api/purchasing/po`).
 *
 * Lijst (status-pills, voortgangsbalk) + status-tabs + leverancier-filter,
 * detail/ontvangst via drawer, create-PO via drawer. Purchasing is niet
 * shop-scoped. Geld is string → render via formatMoney(Number(x)).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Plus, FileText, Truck, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { PoStatusPill, PO_STATUS_TABS } from '@/components/purchasing/poStatus';
import { PoCreateDrawer } from '@/components/purchasing/PoCreateDrawer';
import { PoDetailDrawer } from '@/components/purchasing/PoDetailDrawer';
import { formatMoney, formatDate } from '@/lib/format';
import { asApiError } from '@/lib/api';
import {
  usePurchaseOrderList,
  useSupplierList,
  type PoStatus,
} from '@/components/purchasing/api';

export const Route = createFileRoute('/_app/purchase-orders')({
  component: PurchaseOrdersPage,
});

function PurchaseOrdersPage() {
  const [statusTab, setStatusTab] = useState<PoStatus | 'all'>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [activePoId, setActivePoId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const suppliersQuery = useSupplierList({ limit: 100, offset: 0 });
  const suppliers = suppliersQuery.data?.items ?? [];
  const supplierName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of suppliers) m.set(s.id, s.name);
    return m;
  }, [suppliers]);

  const params = useMemo(
    () => ({
      limit: 100,
      offset: 0,
      status: statusTab === 'all' ? undefined : statusTab,
      supplierId: supplierFilter === 'all' ? undefined : supplierFilter,
    }),
    [statusTab, supplierFilter],
  );

  const query = usePurchaseOrderList(params);
  const pos = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  // KPI's (over de huidige selectie)
  const openCount = pos.filter((p) => p.status === 'ordered' || p.status === 'partial').length;
  const draftCount = pos.filter((p) => p.status === 'draft').length;
  const openAmount = pos
    .filter((p) => p.status === 'ordered' || p.status === 'partial')
    .reduce((s, p) => s + Number(p.total), 0);

  const activePo = activePoId ? pos.find((p) => p.id === activePoId) : undefined;

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Inkoop</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">Purchase-orders aan leveranciers — status, ontvangsten en voorraad.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={15} strokeWidth={2.2} />
          Nieuwe PO
        </button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <Kpi icon={<FileText size={16} />} label="Concept" value={String(draftCount)} color="var(--theme-muted)" />
        <Kpi icon={<Truck size={16} />} label="Open (besteld/deels)" value={String(openCount)} color="var(--info)" />
        <Kpi icon={<AlertCircle size={16} />} label="Openstaand bedrag" value={formatMoney(openAmount, { decimals: false })} color="var(--theme-accent)" />
      </div>

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div className="segmented" role="tablist" aria-label="Status">
          {PO_STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              data-active={statusTab === t.value}
              onClick={() => setStatusTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} style={{ padding: '6px 10px' }}>
          <option value="all">Alle leveranciers</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text" style={{ margin: 0 }}>
            Kon inkooporders niet laden: {asApiError(query.error).message}
          </p>
        </div>
      ) : query.isLoading ? (
        <Skeleton height={360} />
      ) : pos.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={statusTab !== 'all' || supplierFilter !== 'all' ? 'Geen PO\'s gevonden' : 'Nog geen inkooporders'}
          description={
            statusTab !== 'all' || supplierFilter !== 'all'
              ? 'Pas je filters aan om resultaten te zien.'
              : 'Maak je eerste purchase-order aan om voorraad in te kopen.'
          }
          action={
            statusTab === 'all' && supplierFilter === 'all' ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> Nieuwe PO
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="table-wrap">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Referentie</th>
                  <th>Leverancier</th>
                  <th>Aangemaakt</th>
                  <th>Verwacht</th>
                  <th style={{ textAlign: 'right' }}>Regels</th>
                  <th style={{ textAlign: 'right' }}>Totaal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id} onClick={() => setActivePoId(p.id)} style={{ cursor: 'pointer' }}>
                    <td className="mono" style={{ fontWeight: 600, color: 'var(--theme-accent)' }}>
                      {p.reference ?? p.id.slice(0, 8)}
                    </td>
                    <td>{supplierName.get(p.supplierId) ?? '—'}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>{formatDate(p.createdAt)}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>
                      {p.expectedAt ? formatDate(p.expectedAt) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.itemCount}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {formatMoney(Number(p.total))}
                    </td>
                    <td><PoStatusPill status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PoCreateDrawer open={createOpen} onClose={() => setCreateOpen(false)} suppliers={suppliers} />

      <PoDetailDrawer
        poId={activePoId}
        supplierName={activePo ? supplierName.get(activePo.supplierId) : undefined}
        onClose={() => setActivePoId(null)}
      />
    </div>
  );
}

function Kpi({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="kpi-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="kpi-label">{label}</span>
        <span style={{ color, display: 'inline-grid', placeItems: 'center' }}>{icon}</span>
      </div>
      <h2 className="kpi-value">{value}</h2>
    </div>
  );
}
