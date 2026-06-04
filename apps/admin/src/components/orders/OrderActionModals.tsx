/**
 * Actie-modals voor de order-detailpagina (alle op de echte API):
 *   - StatusModal       → PATCH /orders/:id/status   (state-machine)
 *   - FulfillmentModal  → POST  /orders/:id/fulfillments
 *   - PaymentModal      → POST  /orders/:id/payments
 *   - ReturnModal       → POST  /orders/:id/returns
 *
 * Geld = string. Toasts op succes/fout. Mutaties invalideren de detail-query.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import {
  useUpdateOrderStatus,
  useCreateFulfillment,
  useCreatePayment,
  useCreateReturn,
  type OrderDetail,
} from './api';
import { money, toNumber } from './money';

/** Geldige vervolg-statussen per huidige status (mirror status-machine.ts). */
const TRANSITIONS: Record<string, string[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['fulfilled', 'shipped', 'cancelled', 'refunded'],
  fulfilled: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Open',
  paid: 'Betaald',
  fulfilled: 'Verwerkt',
  shipped: 'Verzonden',
  delivered: 'Bezorgd',
  cancelled: 'Geannuleerd',
  refunded: 'Terugbetaald',
};

export function allowedStatuses(current: string): string[] {
  return TRANSITIONS[current] ?? [];
}

/* ─── Status ──────────────────────────────────────────────── */

export function StatusModal({
  open,
  onClose,
  order,
}: {
  open: boolean;
  onClose: () => void;
  order: OrderDetail;
}) {
  const mutate = useUpdateOrderStatus(order.id);
  const allowed = allowedStatuses(order.status);
  const [status, setStatus] = useState(allowed[0] ?? '');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setStatus(allowed[0] ?? '');
      setNote('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.status]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!status) return;
    mutate.mutate(
      { status, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`Status → ${STATUS_LABELS[status] ?? status}`);
          onClose();
        },
        onError: (err) => {
          const e = asApiError(err);
          const allowedList = (e.details as { allowed?: string[] } | undefined)?.allowed;
          toast.error(
            e.code === 'invalid_transition' && allowedList
              ? `Overgang niet toegestaan. Mogelijk: ${allowedList.join(', ')}`
              : `Status wijzigen mislukt: ${e.message}`,
          );
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Status wijzigen"
      subtitle={`Huidig: ${STATUS_LABELS[order.status] ?? order.status}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="status-form" className="btn btn-primary" disabled={mutate.isPending || !status}>
            {mutate.isPending ? 'Opslaan…' : 'Wijzig status'}
          </button>
        </>
      }
    >
      <form id="status-form" onSubmit={onSubmit}>
        {allowed.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Deze order heeft een eindstatus ({STATUS_LABELS[order.status] ?? order.status}) en kan niet verder wijzigen.
          </p>
        ) : (
          <>
            <FormField label="Nieuwe status">
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {allowed.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Notitie (optioneel)">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
            </FormField>
          </>
        )}
      </form>
    </Modal>
  );
}

/* ─── Fulfillment ─────────────────────────────────────────── */

export function FulfillmentModal({
  open,
  onClose,
  order,
}: {
  open: boolean;
  onClose: () => void;
  order: OrderDetail;
}) {
  const mutate = useCreateFulfillment(order.id);
  const [carrier, setCarrier] = useState('PostNL');
  const [trackingCode, setTrackingCode] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [locationId, setLocationId] = useState('');
  const [status, setStatus] = useState<'pending' | 'shipped' | 'delivered'>('shipped');

  useEffect(() => {
    if (open) {
      setCarrier('PostNL');
      setTrackingCode('');
      setTrackingUrl('');
      setLocationId('');
      setStatus('shipped');
    }
  }, [open]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutate.mutate(
      {
        carrier: carrier.trim() || null,
        trackingCode: trackingCode.trim() || null,
        trackingUrl: trackingUrl.trim() || null,
        locationId: locationId.trim() || null,
        status,
      },
      {
        onSuccess: () => {
          toast.success('Fulfilment aangemaakt');
          onClose();
        },
        onError: (err) => {
          const e = asApiError(err);
          toast.error(`Fulfilment mislukt: ${e.message}`);
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Fulfilment aanmaken"
      subtitle="Registreer een verzending voor deze order."
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="fulfillment-form" className="btn btn-primary" disabled={mutate.isPending}>
            {mutate.isPending ? 'Aanmaken…' : 'Fulfilment aanmaken'}
          </button>
        </>
      }
    >
      <form id="fulfillment-form" onSubmit={onSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormField label="Vervoerder">
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="PostNL" />
          </FormField>
          <FormField label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="pending">In behandeling</option>
              <option value="shipped">Verzonden</option>
              <option value="delivered">Bezorgd</option>
            </select>
          </FormField>
        </div>
        <FormField label="Tracking-code">
          <input value={trackingCode} onChange={(e) => setTrackingCode(e.target.value)} placeholder="3SABC123456789" />
        </FormField>
        <FormField label="Tracking-URL (optioneel)">
          <input
            type="url"
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
            placeholder="https://postnl.nl/track/…"
          />
        </FormField>
        <FormField
          label="Locatie-ID (optioneel)"
          hint="UUID van de magazijnlocatie. Er is nog geen locaties-keuzelijst (backend-gap)."
        >
          <input value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="UUID — leeg laten kan" />
        </FormField>
      </form>
    </Modal>
  );
}

/* ─── Payment ─────────────────────────────────────────────── */

export function PaymentModal({
  open,
  onClose,
  order,
}: {
  open: boolean;
  onClose: () => void;
  order: OrderDetail;
}) {
  const mutate = useCreatePayment(order.id);
  const paidSum = useMemo(
    () =>
      order.payments
        .filter((p) => p.status === 'paid')
        .reduce((s, p) => s + toNumber(p.amount), 0),
    [order.payments],
  );
  const outstanding = Math.max(0, toNumber(order.grandTotal) - paidSum);

  const [provider, setProvider] = useState<'mock' | 'ideal' | 'card' | 'bol'>('ideal');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState<'pending' | 'paid' | 'failed' | 'refunded'>('paid');

  useEffect(() => {
    if (open) {
      setProvider('ideal');
      setAmount(outstanding > 0 ? outstanding.toFixed(2) : '');
      setReference('');
      setStatus('paid');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (toNumber(amount) <= 0) {
      toast.error('Bedrag moet groter dan 0 zijn');
      return;
    }
    mutate.mutate(
      {
        provider,
        amount: String(toNumber(amount)),
        status,
        reference: reference.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(`Betaling van ${money(amount)} geregistreerd`);
          onClose();
        },
        onError: (err) => {
          const e = asApiError(err);
          toast.error(`Betaling mislukt: ${e.message}`);
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Betaling toevoegen"
      subtitle={`Openstaand: ${money(outstanding)} van ${money(order.grandTotal)}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="payment-form" className="btn btn-primary" disabled={mutate.isPending}>
            {mutate.isPending ? 'Opslaan…' : 'Betaling registreren'}
          </button>
        </>
      }
    >
      <form id="payment-form" onSubmit={onSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormField label="Methode">
            <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
              <option value="ideal">iDEAL</option>
              <option value="card">Kaart</option>
              <option value="bol">Bol</option>
              <option value="mock">Handmatig</option>
            </select>
          </FormField>
          <FormField label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="paid">Betaald</option>
              <option value="pending">Open</option>
              <option value="failed">Mislukt</option>
              <option value="refunded">Terugbetaald</option>
            </select>
          </FormField>
        </div>
        <FormField label="Bedrag">
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
          />
        </FormField>
        <FormField label="Referentie (optioneel)">
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transactie-ref" />
        </FormField>
      </form>
    </Modal>
  );
}

/* ─── Return / RMA ────────────────────────────────────────── */

export function ReturnModal({
  open,
  onClose,
  order,
}: {
  open: boolean;
  onClose: () => void;
  order: OrderDetail;
}) {
  const mutate = useCreateReturn(order.id);
  const [reason, setReason] = useState('Klant niet tevreden');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restock, setRestock] = useState(true);
  const [refundOverride, setRefundOverride] = useState('');

  useEffect(() => {
    if (open) {
      setReason('Klant niet tevreden');
      setSelected(new Set(order.items.map((i) => i.id)));
      setRestock(true);
      setRefundOverride('');
    }
  }, [open, order.items]);

  const computedRefund = useMemo(
    () =>
      order.items
        .filter((i) => selected.has(i.id))
        .reduce((s, i) => s + toNumber(i.lineTotal), 0),
    [selected, order.items],
  );
  const refund = refundOverride.trim() ? toNumber(refundOverride) : computedRefund;

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (selected.size === 0) {
      toast.error('Selecteer minstens één item');
      return;
    }
    const items = order.items
      .filter((i) => selected.has(i.id))
      .map((i) => ({ orderItemId: i.id, quantity: i.quantity, restock }));
    mutate.mutate(
      {
        reason: reason.trim() || null,
        refundAmount: refund > 0 ? String(refund) : undefined,
        status: 'requested',
        items,
      },
      {
        onSuccess: () => {
          toast.success('Retour (RMA) aangemaakt');
          onClose();
        },
        onError: (err) => {
          const e = asApiError(err);
          toast.error(`Retour mislukt: ${e.message}`);
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Retour aanmaken"
      subtitle={`Te retourneren bedrag: ${money(refund)}`}
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="return-form" className="btn btn-primary" disabled={mutate.isPending}>
            {mutate.isPending ? 'Aanmaken…' : 'Retour aanmaken'}
          </button>
        </>
      }
    >
      <form id="return-form" onSubmit={onSubmit}>
        <FormField label="Items om te retourneren">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {order.items.length === 0 ? (
              <span className="muted" style={{ fontSize: 12.5 }}>Geen items op deze order.</span>
            ) : (
              order.items.map((i) => (
                <label
                  key={i.id}
                  style={{
                    display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px',
                    background: 'var(--surface-2)', borderRadius: 6, cursor: 'pointer', fontSize: 12.5,
                  }}
                >
                  <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} style={{ width: 14, height: 14 }} />
                  <span style={{ flex: 1 }}>
                    <strong>{i.quantity}×</strong> {i.title ?? i.sku ?? 'Item'}
                  </span>
                  <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{money(i.lineTotal)}</span>
                </label>
              ))
            )}
          </div>
        </FormField>
        <FormField label="Reden">
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option>Klant niet tevreden</option>
            <option>Product defect</option>
            <option>Verkeerd verstuurd</option>
            <option>Goodwill-actie</option>
            <option>Anders</option>
          </select>
        </FormField>
        <FormField label="Terugbetaalbedrag (optioneel)" hint="Leeg = automatisch o.b.v. geselecteerde regels.">
          <input
            type="number"
            min={0}
            step="0.01"
            value={refundOverride}
            onChange={(e) => setRefundOverride(e.target.value)}
            placeholder={computedRefund.toFixed(2)}
          />
        </FormField>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--theme-muted)' }}>
          <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} style={{ width: 14, height: 14 }} />
          Items terug op voorraad zetten (restock)
        </label>
      </form>
    </Modal>
  );
}
