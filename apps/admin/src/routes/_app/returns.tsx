/**
 * /returns — RMA-board op de ECHTE API (shop-scoped).
 *
 * Vervangt de oude mock-only preview. Behoudt de board-layout, status-tabs,
 * KPI-rij en detail-drawer. Data komt van /api/returns (zie components/returns/api.ts).
 * De backend boekt restock-items van een refunded return automatisch terug naar
 * voorraad; dat surfacen we per item als "teruggeboekt".
 *
 * Let op data-shape t.o.v. de oude mock:
 *   - geen `rmaNumber`/`customerName`/`reasonDetail` op de return zelf; we tonen
 *     het korte id + de gekoppelde order. `reason` is vrije tekst (geen enum).
 *   - refundAmount is een string (Money). items komen alleen mee in de detail-call.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Search, Undo2, RefreshCcw, AlertCircle, Euro,
  CheckCircle2, X as XIcon, PackageCheck, Plus, Edit3, PackagePlus,
} from 'lucide-react';
import { money, toNumber } from '@/components/orders/money';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { useActiveShop } from '@/lib/shop-context';
import { useOrderList } from '@/components/orders/api';
import {
  useReturns,
  useReturn,
  useCreateReturn,
  useUpdateReturn,
  isRestocked,
  restockedUnits,
  returnItemCount,
  type ReturnDto,
  type ReturnStatus,
  type ReturnListFilters,
} from '@/components/returns/api';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';

export const Route = createFileRoute('/_app/returns')({
  component: ReturnsPage,
});

const PAGE_SIZE = 50;

const STATUS_TABS: Array<{ value: ReturnStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'requested', label: 'Aangevraagd' },
  { value: 'approved', label: 'Goedgekeurd' },
  { value: 'received', label: 'Ontvangen' },
  { value: 'refunded', label: 'Terugbetaald' },
  { value: 'rejected', label: 'Afgewezen' },
];

const STATUS_LABELS: Record<ReturnStatus, { label: string; klass: string }> = {
  requested: { label: 'Aangevraagd', klass: 'badge-info' },
  approved: { label: 'Goedgekeurd', klass: 'badge-warning' },
  received: { label: 'Ontvangen', klass: 'badge-accent' },
  refunded: { label: 'Terugbetaald', klass: 'badge-success' },
  rejected: { label: 'Afgewezen', klass: 'badge-danger' },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_LABELS[status as ReturnStatus];
  if (!m) return <span className="badge badge-neutral">{status}</span>;
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}

/** Korte RMA-weergave van een UUID (eerste segment, upper-case). */
function shortRma(id: string): string {
  return `RMA-${id.slice(0, 8).toUpperCase()}`;
}

function ReturnsPage() {
  const { activeShopId } = useActiveShop();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<ReturnStatus | 'all'>('all');
  const [offset, setOffset] = useState(0);
  const [activeReturnId, setActiveReturnId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [confirmReject, setConfirmReject] = useState<ReturnDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Debounce search (client-side filter op id/order/reason — backend heeft geen
  // free-text search op returns).
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset paging bij filter- of shop-wissel.
  useEffect(() => {
    setOffset(0);
  }, [statusTab, activeShopId]);

  const filters: ReturnListFilters = useMemo(
    () => ({
      status: statusTab === 'all' ? undefined : statusTab,
      limit: PAGE_SIZE,
      offset,
    }),
    [statusTab, offset],
  );

  const query = useReturns(activeShopId, filters);
  const all = query.data?.items ?? [];

  // Client-side search-filter (id / order-id / reason).
  const filtered = useMemo(() => {
    if (!search) return all;
    return all.filter((r) => {
      const hay = `${r.id} ${shortRma(r.id)} ${r.orderId ?? ''} ${r.reason ?? ''}`.toLowerCase();
      return hay.includes(search);
    });
  }, [all, search]);

  // KPI's o.b.v. de geladen pagina.
  const openCount = all.filter((r) => ['requested', 'approved', 'received'].includes(r.status)).length;
  const refundedThisMonth = all.filter((r) => {
    if (r.status !== 'refunded') return false;
    const d = new Date(r.updatedAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const totalRefund = all
    .filter((r) => r.status === 'refunded')
    .reduce((s, r) => s + toNumber(r.refundAmount), 0);

  const hasFilters = statusTab !== 'all' || !!search;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Retouren</h1>
            <span className="count-badge">{all.length}</span>
          </div>
          <p className="page-subtitle">RMA-aanvragen, ontvangsten en refunds.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setCreateOpen(true)}
          disabled={!activeShopId}
        >
          <Plus size={15} strokeWidth={2.2} /> Retour aanmaken
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <SimpleKpi icon={<AlertCircle size={16} />} label="Open retouren" value={String(openCount)} accent="warning" />
        <SimpleKpi icon={<RefreshCcw size={16} />} label="Terugbetaald deze maand" value={String(refundedThisMonth)} accent="success" />
        <SimpleKpi icon={<Undo2 size={16} />} label="Retouren (pagina)" value={String(all.length)} accent="info" />
        <SimpleKpi icon={<Euro size={16} />} label="Refund-totaal" value={money(totalRefund, { decimals: false })} accent="accent" />
      </div>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <div className="search-input">
          <Search size={14} />
          <input
            aria-label="Zoek retouren"
            placeholder="Zoek op RMA, order-id of reden…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="segmented" role="tablist" aria-label="Status">
          {STATUS_TABS.map((t) => (
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
      </div>

      {/* Content */}
      {!activeShopId ? (
        <EmptyState
          icon={Undo2}
          title="Geen shop geselecteerd"
          description="Kies een shop in de balk bovenaan om retouren te bekijken."
        />
      ) : query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">
            Kon retouren niet laden. Controleer of de backend draait en probeer pagina-refresh.
          </p>
        </div>
      ) : query.isLoading ? (
        <SkeletonTableRows rows={8} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Undo2}
          title={hasFilters ? 'Geen retouren gevonden' : 'Nog geen retouren'}
          description={
            hasFilters
              ? 'Pas je zoekopdracht of status-filter aan.'
              : 'Er zijn nog geen retouren voor deze shop. Maak er handmatig één aan vanuit een order.'
          }
          action={
            !hasFilters ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> Retour aanmaken
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
                  <th>RMA</th>
                  <th>Order</th>
                  <th>Reden</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Refund</th>
                  <th>Aangemaakt</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => { setActiveReturnId(r.id); setEditMode(false); }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="mono" style={{ fontWeight: 600, color: 'var(--theme-accent)' }}>
                      {shortRma(r.id)}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {r.orderId ? r.orderId.slice(0, 8) : <span className="muted">—</span>}
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      {r.reason
                        ? <span style={{ fontSize: 13 }}>{r.reason}</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td><StatusBadge status={r.status} /></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {toNumber(r.refundAmount) > 0 ? money(r.refundAmount) : <span className="muted">—</span>}
                    </td>
                    <td>
                      <div style={{ fontSize: 12.5 }}>{formatDate(r.createdAt)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{formatRelative(r.createdAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Paginatie (board levert geen total → next-knop op basis van vol-pagina) */}
      {!query.isLoading && (offset > 0 || all.length >= PAGE_SIZE) && (
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Vorige
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={all.length < PAGE_SIZE}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Volgende
          </button>
        </div>
      )}

      <ReturnDrawer
        returnId={activeReturnId}
        editing={editMode}
        onClose={() => { setActiveReturnId(null); setEditMode(false); }}
        onReject={(r) => setConfirmReject(r)}
        onToggleEdit={() => setEditMode((v) => !v)}
      />

      <CreateReturnDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        shopId={activeShopId}
        onCreated={(id) => {
          setCreateOpen(false);
          setActiveReturnId(id);
          setEditMode(false);
        }}
      />

      <ConfirmRejectDialog
        ret={confirmReject}
        onClose={() => setConfirmReject(null)}
      />
    </div>
  );
}

// ─── Reject-bevestiging (eigen mutatie zodat we returnId hebben) ────

function ConfirmRejectDialog({ ret, onClose }: { ret: ReturnDto | null; onClose: () => void }) {
  const update = useUpdateReturn(ret?.id ?? '__none__');
  return (
    <ConfirmDialog
      open={ret !== null}
      onClose={onClose}
      onConfirm={() => {
        if (!ret) return;
        update.mutate(
          { status: 'rejected', refundAmount: '0' },
          {
            onSuccess: () => toast.success(`${shortRma(ret.id)} afgewezen`),
            onError: (e) => toast.error(asApiError(e).message),
          },
        );
      }}
      title="Retour afwijzen?"
      message={ret ? `${shortRma(ret.id)} wordt gemarkeerd als afgewezen. Klant krijgt geen refund.` : ''}
      confirmLabel="Ja, afwijzen"
    />
  );
}

// ─── Create-drawer (top-level POST /api/returns met order-koppeling) ─

function CreateReturnDrawer({
  open, onClose, shopId, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  shopId: string | null;
  onCreated: (id: string) => void;
}) {
  const [orderId, setOrderId] = useState('');
  const [reason, setReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const create = useCreateReturn();

  // Orders van de actieve shop voor de picker (laatste 50).
  const ordersQuery = useOrderList(open ? shopId : null, {
    limit: 50,
    offset: 0,
  });
  const orders = ordersQuery.data?.items ?? [];

  useEffect(() => {
    if (open) {
      setOrderId('');
      setReason('');
      setRefundAmount('');
    }
  }, [open]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!shopId) {
      toast.error('Geen shop geselecteerd');
      return;
    }
    if (!orderId) {
      toast.error('Kies een order');
      return;
    }
    create.mutate(
      {
        shopId,
        orderId,
        reason: reason.trim() || null,
        refundAmount: refundAmount.trim() ? refundAmount.trim() : undefined,
        status: 'requested',
        items: [],
      },
      {
        onSuccess: (r) => {
          toast.success(`${shortRma(r.id)} aangemaakt`);
          onCreated(r.id);
        },
        onError: (err) => toast.error(asApiError(err).message),
      },
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Retour aanmaken"
      subtitle="Handmatig RMA — meestal getriggerd vanuit klant-mail."
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="rma-create" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Bezig…' : 'Aanmaken'}
          </button>
        </>
      }
    >
      <form id="rma-create" onSubmit={onSubmit}>
        <FormField label="Order" required hint={ordersQuery.isLoading ? 'Orders laden…' : undefined}>
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
            <option value="">— Kies order —</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNumber} — {o.customerName ?? o.email ?? 'onbekend'} — {money(o.grandTotal)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Reden">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            style={{ resize: 'vertical', minHeight: 50 }}
            placeholder="Bijv. Maat te klein, verkeerd product geleverd…"
          />
        </FormField>
        <FormField label="Refund-bedrag" hint="Laat leeg voor € 0,00 — kan later in de detail-drawer.">
          <input
            type="number"
            min={0}
            step="0.01"
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
            placeholder="0.00"
          />
        </FormField>
      </form>
    </Drawer>
  );
}

// ─── Detail-drawer (GET /api/returns/:id + PATCH voor edit/transitie) ─

function ReturnDrawer({
  returnId,
  editing,
  onClose,
  onReject,
  onToggleEdit,
}: {
  returnId: string | null;
  editing: boolean;
  onClose: () => void;
  onReject: (r: ReturnDto) => void;
  onToggleEdit: () => void;
}) {
  const navigate = useNavigate();
  const detail = useReturn(returnId ?? undefined);
  const update = useUpdateReturn(returnId ?? '__none__');
  const rma = detail.data ?? null;

  // Edit-form state.
  const [editReason, setEditReason] = useState('');
  const [editRefund, setEditRefund] = useState('');

  useEffect(() => {
    if (rma) {
      setEditReason(rma.reason ?? '');
      setEditRefund(rma.refundAmount ?? '');
    }
  }, [rma?.id, editing]);

  function saveEdit() {
    if (!rma) return;
    update.mutate(
      {
        reason: editReason.trim() || null,
        refundAmount: editRefund.trim() ? editRefund.trim() : '0',
      },
      {
        onSuccess: () => {
          toast.success(`${shortRma(rma.id)} bijgewerkt`);
          onToggleEdit();
        },
        onError: (e) => toast.error(asApiError(e).message),
      },
    );
  }

  function transition(status: ReturnStatus, successMsg: string) {
    if (!rma) return;
    update.mutate(
      { status },
      {
        onSuccess: () => toast.success(successMsg),
        onError: (e) => toast.error(asApiError(e).message),
      },
    );
  }

  const items = rma?.items ?? [];
  const restockedTotal = restockedUnits(items);
  const showRestockBanner = rma ? isRestocked(rma) : false;

  return (
    <Drawer
      open={returnId !== null}
      onClose={onClose}
      title={rma ? shortRma(rma.id) : 'Retour'}
      subtitle={rma?.orderId ? `Order ${rma.orderId.slice(0, 8)}` : 'Geen gekoppelde order'}
      footer={
        rma && (editing ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onToggleEdit}>Annuleer</button>
            <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={update.isPending}>
              {update.isPending ? 'Bezig…' : 'Opslaan'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Sluit</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onToggleEdit}>
              <Edit3 size={13} /> Bewerken
            </button>
            {rma.status === 'requested' && (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => onReject(rma)} disabled={update.isPending}>
                  <XIcon size={13} /> Afwijzen
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => transition('approved', `${shortRma(rma.id)} goedgekeurd`)}
                  disabled={update.isPending}
                >
                  <CheckCircle2 size={13} /> Goedkeuren
                </button>
              </>
            )}
            {rma.status === 'approved' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => transition('received', `${shortRma(rma.id)} gemarkeerd als ontvangen`)}
                disabled={update.isPending}
              >
                <PackageCheck size={13} /> Markeer ontvangen
              </button>
            )}
            {rma.status === 'received' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => transition('refunded', `Refund van ${money(rma.refundAmount)} verwerkt voor ${shortRma(rma.id)}`)}
                disabled={update.isPending}
              >
                <Euro size={13} /> Refund {money(rma.refundAmount)}
              </button>
            )}
          </>
        ))
      }
    >
      {detail.isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SkeletonTableRows rows={3} />
        </div>
      )}

      {detail.isError && (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">Kon retour niet laden.</p>
        </div>
      )}

      {rma && editing && (
        <>
          <FormField label="Reden">
            <textarea
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              rows={2}
              style={{ resize: 'vertical', minHeight: 50 }}
              placeholder="Toelichting op de retour…"
            />
          </FormField>
          <FormField label="Refund-bedrag" hint="In euro's. Wordt bij refund verwerkt + (bij restock-items) teruggeboekt naar voorraad.">
            <input
              type="number"
              min={0}
              step="0.01"
              value={editRefund}
              onChange={(e) => setEditRefund(e.target.value)}
            />
          </FormField>
        </>
      )}

      {rma && !editing && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            <StatusBadge status={rma.status} />
            {showRestockBanner && (
              <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <PackagePlus size={12} /> Teruggeboekt
              </span>
            )}
          </div>

          <h3 className="drawer-section-title" style={sectionTitleStyle}>Reden</h3>
          <div style={{ fontSize: 13.5, marginBottom: 14, color: 'var(--text-soft)' }}>
            {rma.reason || <span className="muted">Geen reden opgegeven</span>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
            <Stat label="Items" value={String(returnItemCount(items))} />
            <Stat label="Refund" value={toNumber(rma.refundAmount) > 0 ? money(rma.refundAmount, { decimals: false }) : '—'} />
            <Stat label="Aangemaakt" value={formatRelative(rma.createdAt)} small />
          </div>

          {/* Retour-items + restock-indicator */}
          {items.length > 0 && (
            <>
              <h3 style={sectionTitleStyle}>Retour-items</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                {items.map((it) => {
                  const restocked = rma.status === 'refunded' && it.restock && (it.quantity ?? 0) > 0;
                  return (
                    <div
                      key={it.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '8px 10px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="mono" style={{ fontSize: 12 }}>
                          {it.orderItemId ? it.orderItemId.slice(0, 8) : 'losse regel'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--theme-muted)' }}>
                          {it.quantity ?? 0} stuk(s)
                        </div>
                      </div>
                      {restocked ? (
                        <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <PackagePlus size={11} /> Teruggeboekt
                        </span>
                      ) : it.restock ? (
                        <span className="badge badge-neutral" title="Wordt teruggeboekt zodra de retour is terugbetaald">
                          Restock bij refund
                        </span>
                      ) : (
                        <span className="badge badge-neutral">Niet terug</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {showRestockBanner && (
                <div style={{ fontSize: 12, color: 'var(--theme-muted)', marginBottom: 14 }}>
                  {restockedTotal} stuk(s) automatisch teruggeboekt naar voorraad.
                </div>
              )}
            </>
          )}

          {/* Gekoppelde order */}
          {rma.orderId && (
            <>
              <h3 style={sectionTitleStyle}>Gerelateerde order</h3>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  void navigate({ to: '/orders/$id', params: { id: rma.orderId! } });
                }}
                style={{
                  display: 'flex',
                  width: '100%',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 12px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  color: 'inherit',
                  cursor: 'pointer',
                  marginBottom: 16,
                }}
              >
                <span className="mono" style={{ color: 'var(--theme-accent)', fontWeight: 600 }}>
                  {rma.orderId.slice(0, 8)}
                </span>
                <span style={{ color: 'var(--theme-muted)', fontSize: 12 }}>Open order →</span>
              </button>
            </>
          )}

          <div style={{ fontSize: 12, color: 'var(--theme-muted)' }}>
            Laatst bijgewerkt {formatDateTime(rma.updatedAt)}
          </div>
        </>
      )}
    </Drawer>
  );
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--theme-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  margin: '0 0 6px',
};

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div style={{
      padding: '8px 10px',
      background: 'var(--surface-2)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 8,
    }}>
      <div style={{ fontSize: 10, color: 'var(--theme-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: small ? 12 : 16, fontWeight: 700, color: 'var(--text-strong)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function SimpleKpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: 'info' | 'success' | 'warning' | 'accent' }) {
  const color = accent === 'info' ? 'var(--info)' : accent === 'success' ? 'var(--success)' : accent === 'warning' ? 'var(--warning)' : 'var(--theme-accent)';
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
