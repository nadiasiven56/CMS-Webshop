/**
 * /discounts (index) — kortings-/vouchercodes op de ECHTE API
 * (`/api/discounts`). Een tabel met code, type, waarde, afgeleide status-pill,
 * inwisselingen (timesRedeemed/maxRedemptions) en geldigheidsvenster. Een
 * add/edit-drawer met alle velden (type-select stuurt of `value` % of bedrag is;
 * free_shipping verbergt de waarde), een per-rij inwisselingen-view, een
 * "Code testen"-paneel (POST /validate) en delete met ConfirmDialog.
 *
 * Mirror van channels.index.tsx (table-pattern uit orders.index.tsx + drawer +
 * EmptyState + skeleton + toast). Dit is de INDEX-route van het discounts-layout
 * (discounts.tsx rendert enkel <Outlet/>).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Plus, Percent, Pencil, Trash2, Ticket } from 'lucide-react';
import { DiscountStatusPill } from '@/components/discounts/DiscountStatusPill';
import { DiscountDrawer } from '@/components/discounts/DiscountDrawer';
import { RedemptionsDrawer } from '@/components/discounts/RedemptionsDrawer';
import { ValidatePanel } from '@/components/discounts/ValidatePanel';
import {
  useDiscounts,
  useDeleteDiscount,
  discountTypeMeta,
  type DiscountDto,
} from '@/components/discounts/api';
import { formatDate } from '@/lib/format';
import { asApiError } from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { ClickableRow } from '@/components/ui/ClickableRow';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/discounts/')({
  component: DiscountsPage,
});

function DiscountsPage() {
  const query = useDiscounts();
  const del = useDeleteDiscount();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<DiscountDto | null>(null);
  const [redemptionsFor, setRedemptionsFor] = useState<DiscountDto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DiscountDto | null>(null);

  const discounts = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  function openNew() {
    setEditing(null);
    setDrawerOpen(true);
  }

  function openEdit(d: DiscountDto) {
    setEditing(d);
    setDrawerOpen(true);
  }

  async function doDelete(d: DiscountDto) {
    try {
      await del.mutateAsync(d.id);
      toast.success(`Code ${d.code} verwijderd`);
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Verwijderen mislukt: ${e2.message}`);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Kortingen</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">
            Kortings- en vouchercodes — percentage, vast bedrag of gratis verzending.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <Plus size={15} strokeWidth={2.2} />
            Code toevoegen
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 20, alignItems: 'start' }}>
        {/* ─── Tabel ──────────────────────────────────────── */}
        <div>
          {query.isError ? (
            <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
              <p className="error-text">
                Kon kortingen niet laden. Controleer of de backend draait en probeer pagina-refresh.
              </p>
            </div>
          ) : query.isLoading ? (
            <SkeletonTableRows rows={6} />
          ) : discounts.length === 0 ? (
            <EmptyState
              icon={Percent}
              title="Nog geen kortingen"
              description="Maak een kortingscode aan — percentage, vast bedrag of gratis verzending."
              action={
                <button type="button" className="btn btn-primary" onClick={openNew}>
                  <Plus size={14} /> Code toevoegen
                </button>
              }
            />
          ) : (
            <div className="table-wrap">
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Type</th>
                      <th style={{ textAlign: 'right' }}>Waarde</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Ingewisseld</th>
                      <th>Geldig</th>
                      <th style={{ textAlign: 'right' }}>Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discounts.map((d) => (
                      <ClickableRow
                        key={d.id}
                        onActivate={() => openEdit(d)}
                        ariaLabel={`Bewerk kortingscode ${d.code}`}
                      >
                        <td>
                          <span className="mono" style={{ color: 'var(--theme-accent)', fontWeight: 600 }}>
                            {d.code}
                          </span>
                          {d.description && (
                            <div style={{ fontSize: 11.5, color: 'var(--theme-muted)', marginTop: 2 }}>
                              {d.description}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: 12.5 }}>{discountTypeMeta(d.type).label}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {formatValue(d)}
                        </td>
                        <td><DiscountStatusPill status={d.status} /></td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>
                          {d.timesRedeemed}
                          {d.maxRedemptions != null && (
                            <span style={{ color: 'var(--theme-muted)' }}> / {d.maxRedemptions}</span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--theme-muted)' }}>
                          {formatWindow(d)}
                        </td>
                        <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'inline-flex', gap: 4, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="icon-btn"
                              style={{ width: 28, height: 28 }}
                              title="Inwisselingen"
                              onClick={() => setRedemptionsFor(d)}
                            >
                              <Ticket size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              style={{ width: 28, height: 28 }}
                              title="Bewerken"
                              onClick={() => openEdit(d)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              style={{ width: 28, height: 28, color: 'var(--danger)' }}
                              title="Verwijderen"
                              onClick={() => setConfirmDelete(d)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </ClickableRow>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ─── Code testen ────────────────────────────────── */}
        <ValidatePanel />
      </div>

      <DiscountDrawer
        discount={editing}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditing(null);
        }}
      />
      <RedemptionsDrawer discount={redemptionsFor} onClose={() => setRedemptionsFor(null)} />
      <ConfirmDialog
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void doDelete(confirmDelete);
        }}
        title="Code verwijderen?"
        message={
          confirmDelete
            ? `Weet je zeker dat je code "${confirmDelete.code}" wilt verwijderen? Dit verwijdert ook de bijbehorende inwisselings-historie.`
            : undefined
        }
        confirmLabel="Verwijderen"
      />
    </div>
  );
}

/** Toon de waarde afhankelijk van het type (percentage / bedrag / n.v.t.). */
function formatValue(d: DiscountDto): string {
  if (d.type === 'free_shipping') return 'Gratis verzending';
  if (d.type === 'percentage') {
    const n = Number(d.value);
    return Number.isFinite(n) ? `${n}%` : `${d.value}%`;
  }
  return `${d.value} ${d.currency}`;
}

/** Compacte weergave van het geldigheidsvenster. */
function formatWindow(d: DiscountDto): string {
  if (!d.startsAt && !d.endsAt) return 'altijd';
  const from = d.startsAt ? formatDate(d.startsAt) : '…';
  const to = d.endsAt ? formatDate(d.endsAt) : '…';
  return `${from} → ${to}`;
}
