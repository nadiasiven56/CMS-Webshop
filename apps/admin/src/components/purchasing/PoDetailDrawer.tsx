/**
 * PoDetailDrawer — purchase-order detail + acties tegen de echte API.
 *
 * Toont: header (status/leverancier/datums/referentie), items (besteld /
 * ontvangen / openstaand / regel-totaal), totalen.
 *
 * Acties:
 *   - Status-transities via PATCH (draft → ordered, … → cancelled).
 *   - Ontvangst-flow: per regel een te-ontvangen-aantal invoeren →
 *     POST /purchasing/po/:id/receive. Backend boekt voorraad-mutaties en
 *     geeft per regel newOnHand terug; dat tonen we als feedback.
 *   - Verwijderen (alleen draft/cancelled).
 *
 * Geld is string → render via formatMoney(Number(x)).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  PackageCheck, Send, X as XIcon, Trash2, Truck, CheckCircle2,
} from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoney, formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import { PoStatusPill } from './poStatus';
import {
  usePurchaseOrderDetail,
  useUpdatePurchaseOrder,
  useReceivePurchaseOrder,
  useDeletePurchaseOrder,
  type PoStatus,
  type ReceivedLineResult,
} from './api';

interface Props {
  poId: string | null;
  supplierName?: string;
  onClose: () => void;
}

export function PoDetailDrawer({ poId, supplierName, onClose }: Props) {
  const open = poId != null;
  const detail = usePurchaseOrderDetail(poId ?? undefined);
  const updateMut = useUpdatePurchaseOrder();
  const receiveMut = useReceivePurchaseOrder();
  const deleteMut = useDeletePurchaseOrder();

  const po = detail.data;

  // receive-state: per item-id het in te boeken aantal
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [locationOverride, setLocationOverride] = useState('');
  const [needsLocation, setNeedsLocation] = useState(false);
  const [lastReceived, setLastReceived] = useState<ReceivedLineResult[] | null>(null);

  useEffect(() => {
    setReceiveQty({});
    setLocationOverride('');
    setNeedsLocation(false);
    setLastReceived(null);
  }, [poId]);

  const busy = updateMut.isPending || receiveMut.isPending || deleteMut.isPending;

  const isTerminal = po ? po.status === 'received' || po.status === 'cancelled' : true;
  const canReceive = po ? po.status === 'ordered' || po.status === 'partial' : false;
  const totalOutstanding = useMemo(
    () => (po ? po.items.reduce((s, it) => s + it.quantityOutstanding, 0) : 0),
    [po],
  );

  async function setStatus(status: PoStatus, label: string) {
    if (!po) return;
    try {
      await updateMut.mutateAsync({ id: po.id, patch: { status } });
      toast.success(label);
    } catch (err) {
      const e = asApiError(err);
      toast.error(e.message || 'Status wijzigen mislukt');
    }
  }

  async function handleDelete() {
    if (!po) return;
    try {
      await deleteMut.mutateAsync(po.id);
      toast.success('PO verwijderd');
      onClose();
    } catch (err) {
      const e = asApiError(err);
      toast.error(e.message || 'Verwijderen mislukt');
    }
  }

  function fillRemaining() {
    if (!po) return;
    const next: Record<string, number> = {};
    for (const it of po.items) {
      if (it.quantityOutstanding > 0) next[it.id] = it.quantityOutstanding;
    }
    setReceiveQty(next);
  }

  async function submitReceive() {
    if (!po) return;
    const linesToReceive = Object.entries(receiveQty)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantity]) => ({ itemId, quantity }));

    if (linesToReceive.length === 0) {
      toast.error('Vul minstens 1 te-ontvangen aantal in');
      return;
    }
    // over-receive client-side afvangen (backend valideert ook)
    for (const line of linesToReceive) {
      const item = po.items.find((it) => it.id === line.itemId);
      if (item && line.quantity > item.quantityOutstanding) {
        toast.error(`Max ${item.quantityOutstanding} resterend voor ${item.sku ?? 'regel'}`);
        return;
      }
    }

    try {
      const res = await receiveMut.mutateAsync({
        id: po.id,
        input: {
          lines: linesToReceive,
          locationId: locationOverride.trim() || undefined,
        },
      });
      setReceiveQty({});
      setLastReceived(res.received);
      setNeedsLocation(false);
      setLocationOverride('');
      const movedStock = res.received.some((r) => r.newOnHand !== null);
      toast.success(
        res.purchaseOrder.status === 'received'
          ? 'Volledig ontvangen — voorraad bijgewerkt'
          : movedStock
            ? 'Ontvangst geboekt — voorraad bijgewerkt'
            : 'Ontvangst geboekt',
      );
    } catch (err) {
      const e = asApiError(err);
      // backend vraagt om een location als po.location_id ontbreekt
      if (e.code === 'location_required') {
        setNeedsLocation(true);
        toast.error('Deze PO heeft geen locatie; geef een locatie-ID op.');
        return;
      }
      if (e.code === 'over_receive') {
        toast.error('Te veel ontvangen t.o.v. besteld.');
        return;
      }
      toast.error(e.message || 'Ontvangst boeken mislukt');
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={680}
      title={po ? `PO ${po.reference ?? po.id.slice(0, 8)}` : 'Purchase-order'}
      subtitle={po ? `${supplierName ?? ''} • ${formatMoney(Number(po.total))}` : 'Laden…'}
      footer={
        po ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Sluit
            </button>
            {(po.status === 'draft' || po.status === 'cancelled') && (
              <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={busy}>
                <Trash2 size={13} /> Verwijder
              </button>
            )}
            {!isTerminal && po.status !== 'cancelled' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStatus('cancelled', 'PO geannuleerd')}
                disabled={busy}
              >
                <XIcon size={13} /> Annuleer PO
              </button>
            )}
            {po.status === 'draft' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStatus('ordered', 'PO besteld bij leverancier')}
                disabled={busy}
              >
                <Send size={13} /> Markeer besteld
              </button>
            )}
          </>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={onClose}>Sluit</button>
        )
      }
    >
      {detail.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Skeleton height={40} />
          <Skeleton height={160} />
          <Skeleton height={90} />
        </div>
      ) : detail.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text" style={{ margin: 0 }}>
            Kon PO niet laden: {asApiError(detail.error).message}
          </p>
        </div>
      ) : !po ? null : (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <PoStatusPill status={po.status} />
            {po.expectedAt && <span className="badge badge-neutral">Verwacht: {formatDate(po.expectedAt)}</span>}
            <span className="badge badge-neutral">Aangemaakt: {formatDate(po.createdAt)}</span>
            {po.receivedAt && <span className="badge badge-success">Ontvangen: {formatDate(po.receivedAt)}</span>}
          </div>

          {po.notes && (
            <div
              style={{
                padding: '10px 12px', background: 'var(--theme-accent-subtle)',
                border: '1px solid var(--theme-accent-border)', borderRadius: 8,
                fontSize: 12.5, color: 'var(--text-soft)', marginBottom: 16,
              }}
            >
              {po.notes}
            </div>
          )}

          {/* Items + ontvangst */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={sectionTitleStyle}>Items ({po.items.length})</h3>
            {canReceive && totalOutstanding > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={fillRemaining} disabled={busy}>
                <PackageCheck size={12} /> Vul restant
              </button>
            )}
          </div>

          <div className="table-wrap" style={{ marginBottom: 16 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th style={{ textAlign: 'right' }}>Besteld</th>
                  <th style={{ textAlign: 'right' }}>Ontvangen</th>
                  <th style={{ textAlign: 'right' }}>Open</th>
                  <th style={{ textAlign: 'right' }}>Regel</th>
                  {canReceive && <th style={{ width: 90 }}>Ontvang</th>}
                </tr>
              </thead>
              <tbody>
                {po.items.map((it) => {
                  const complete = it.quantityOutstanding === 0;
                  return (
                    <tr key={it.id}>
                      <td>
                        <div className="mono" style={{ fontSize: 12 }}>{it.sku ?? '—'}</div>
                        {it.unitCost && (
                          <div style={{ fontSize: 11, color: 'var(--theme-muted)' }}>
                            {formatMoney(Number(it.unitCost))}/st
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.quantity}</td>
                      <td
                        style={{
                          textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                          color: complete ? 'var(--success)' : 'var(--theme-text)',
                        }}
                      >
                        {it.quantityReceived}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.quantityOutstanding}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {it.lineTotal ? formatMoney(Number(it.lineTotal)) : '—'}
                      </td>
                      {canReceive && (
                        <td>
                          {complete ? (
                            <span className="badge badge-success" style={{ fontSize: 10.5 }}>compleet</span>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              max={it.quantityOutstanding}
                              value={receiveQty[it.id] ?? ''}
                              onChange={(e) =>
                                setReceiveQty((s) => ({ ...s, [it.id]: Math.max(0, Number(e.target.value)) }))
                              }
                              placeholder={`max ${it.quantityOutstanding}`}
                              style={{ width: 78, padding: '4px 6px', fontSize: 12, textAlign: 'right' }}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Receive-actiebalk */}
          {canReceive && totalOutstanding > 0 && (
            <div
              style={{
                padding: '12px', border: '1px solid var(--theme-accent-border)',
                background: 'var(--theme-accent-subtle)', borderRadius: 8, marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: needsLocation ? 8 : 10 }}>
                <Truck size={15} style={{ color: 'var(--theme-accent)' }} />
                <strong style={{ fontSize: 13 }}>Ontvangst boeken</strong>
                <span className="muted" style={{ fontSize: 12 }}>— verhoogt de voorraad op de PO-locatie</span>
              </div>
              {needsLocation && (
                <div style={{ marginBottom: 10 }}>
                  <input
                    type="text"
                    value={locationOverride}
                    onChange={(e) => setLocationOverride(e.target.value)}
                    placeholder="Locatie-ID (UUID) — vereist, PO heeft geen vaste locatie"
                    style={{ width: '100%', fontSize: 12, padding: '6px 8px' }}
                  />
                </div>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={submitReceive}
                disabled={busy}
              >
                <PackageCheck size={13} /> {receiveMut.isPending ? 'Boeken…' : 'Ontvangst boeken'}
              </button>
            </div>
          )}

          {/* Feedback laatste ontvangst (voorraad-mutatie) */}
          {lastReceived && lastReceived.length > 0 && (
            <div
              style={{
                padding: '10px 12px', border: '1px solid var(--success-border, var(--border-default))',
                background: 'var(--success-soft)', borderRadius: 8, marginBottom: 16, fontSize: 12.5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: 'var(--success)', fontWeight: 600 }}>
                <CheckCircle2 size={14} /> Laatste ontvangst geboekt
              </div>
              {lastReceived.map((r) => (
                <div key={r.itemId} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-soft)' }}>
                  <span>+{r.quantity} ontvangen</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {r.newOnHand !== null ? `voorraad → ${r.newOnHand}` : 'geen voorraad-mutatie'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Totalen */}
          <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
            <Row label="Subtotaal (excl)" value={formatMoney(Number(po.subtotal))} />
            <Row label="BTW" value={formatMoney(Number(po.taxTotal))} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
              <span>Totaal (incl)</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(Number(po.total))}</span>
            </div>
          </div>
        </>
      )}
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
      <span style={{ color: 'var(--theme-muted)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--theme-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  margin: 0,
  fontWeight: 600,
};
