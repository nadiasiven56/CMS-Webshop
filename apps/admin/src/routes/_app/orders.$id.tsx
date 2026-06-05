/**
 * /orders/:id — order-detail op de ECHTE API (id = order UUID).
 *
 * Toont items (met marge/inkoop), klant, totalen, payments, fulfillments en
 * returns. Acties via modals: status wijzigen, fulfilment, betaling, retour.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ChevronLeft, Package, User, MapPin, Truck, CreditCard, RotateCcw, ArrowRightLeft,
} from 'lucide-react';
import {
  ChannelPill,
  OrderStatusPill,
  FinancialStatusPill,
  FulfillmentStatusPill,
  PaymentStatusPill,
  ReturnStatusPill,
} from '@/components/orders/Pills';
import {
  StatusModal,
  FulfillmentModal,
  PaymentModal,
  ReturnModal,
  allowedStatuses,
} from '@/components/orders/OrderActionModals';
import { useOrderDetail, type OrderItemDto, type OrderAddress } from '@/components/orders/api';
import { money, marginPct } from '@/components/orders/money';
import { formatDateTime } from '@/lib/format';
import { SkeletonRows } from '@/components/ui/Skeleton';

export const Route = createFileRoute('/_app/orders/$id')({
  component: OrderDetailPage,
});

function OrderDetailPage() {
  const { id } = Route.useParams();
  const query = useOrderDetail(id);

  const [statusOpen, setStatusOpen] = useState(false);
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);

  if (query.isLoading) {
    return (
      <div>
        <BackLink />
        <div className="card" style={{ marginTop: 12 }}>
          <SkeletonRows rows={6} />
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div>
        <BackLink />
        <div className="empty-state" style={{ marginTop: 12 }}>
          <h2>Order niet gevonden</h2>
          <p>De order bestaat niet (meer) of het ID klopt niet.</p>
          <Link to="/orders" className="btn btn-secondary" style={{ marginTop: 12 }}>
            Terug naar orders
          </Link>
        </div>
      </div>
    );
  }

  const order = query.data;
  const canChangeStatus = allowedStatuses(order.status).length > 0;
  const customerName =
    [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ').trim() ||
    order.customer?.company ||
    null;

  return (
    <div>
      <BackLink />

      <div className="page-header">
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Order
          </div>
          <div className="page-title-row">
            <h1 className="page-title mono" style={{ fontFamily: 'inherit' }}>{order.orderNumber}</h1>
            <OrderStatusPill status={order.status} />
            <FinancialStatusPill status={order.financialStatus} />
            <ChannelPill slug={order.channel} />
          </div>
          <p className="page-subtitle">
            Aangemaakt {formatDateTime(order.createdAt)} • {order.items.length} regels • {money(order.grandTotal)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setPaymentOpen(true)}>
            <CreditCard size={14} /> Betaling
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setFulfillOpen(true)}>
            <Truck size={14} /> Fulfilment
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setStatusOpen(true)}
            disabled={!canChangeStatus}
            title={canChangeStatus ? undefined : 'Eindstatus — geen verdere transitie'}
          >
            <ArrowRightLeft size={14} /> Status wijzigen
          </button>
        </div>
      </div>

      <div className="detail-grid">
        {/* Main column */}
        <div className="section-stack">
          {/* Items */}
          <div className="card card-flush">
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="card-title">Regels ({order.items.length})</h2>
              {order.margin !== null && (
                <span className="badge badge-success">
                  Marge {money(order.margin)} ({marginPct(order.marginPct)})
                </span>
              )}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ borderRadius: 0 }}>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th style={{ textAlign: 'right' }}>Aantal</th>
                    <th style={{ textAlign: 'right' }}>Prijs</th>
                    <th style={{ textAlign: 'right' }}>Inkoop</th>
                    <th style={{ textAlign: 'right' }}>Marge</th>
                    <th style={{ textAlign: 'right' }}>Totaal</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((l) => (
                    <ItemRow key={l.id} item={l} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payments */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Betalingen ({order.payments.length})</h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPaymentOpen(true)}>
                <CreditCard size={13} /> Toevoegen
              </button>
            </div>
            {order.payments.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Nog geen betalingen geregistreerd.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {order.payments.map((p) => (
                  <div key={p.id} style={rowStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <PaymentStatusPill status={p.status} />
                      <span style={{ fontSize: 12.5 }}>{p.provider ?? 'onbekend'}</span>
                      {p.reference && <span className="mono muted" style={{ fontSize: 11.5 }}>{p.reference}</span>}
                    </div>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Fulfillments */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Fulfilments ({order.fulfillments.length})</h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFulfillOpen(true)}>
                <Truck size={13} /> Aanmaken
              </button>
            </div>
            {order.fulfillments.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Nog geen verzending aangemaakt.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {order.fulfillments.map((f) => (
                  <div key={f.id} style={rowStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <FulfillmentStatusPill status={f.status} />
                      <span style={{ fontSize: 12.5 }}>{f.carrier ?? 'vervoerder onbekend'}</span>
                      {f.trackingCode && (
                        f.trackingUrl ? (
                          <a href={f.trackingUrl} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11.5, color: 'var(--theme-accent)' }}>
                            {f.trackingCode}
                          </a>
                        ) : (
                          <span className="mono muted" style={{ fontSize: 11.5 }}>{f.trackingCode}</span>
                        )
                      )}
                    </div>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {f.shippedAt ? formatDateTime(f.shippedAt) : formatDateTime(f.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Returns */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Retouren ({order.returns.length})</h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReturnOpen(true)}>
                <RotateCcw size={13} /> Aanmaken
              </button>
            </div>
            {order.returns.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Geen retouren voor deze order.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {order.returns.map((r) => (
                  <div key={r.id} style={rowStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <ReturnStatusPill status={r.status} />
                      {r.reason && <span style={{ fontSize: 12.5 }}>{r.reason}</span>}
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {(r.items?.length ?? 0)} item(s)
                      </span>
                    </div>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(r.refundAmount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Aside */}
        <div className="aside-stack">
          {/* Klant */}
          <div className="card">
            <div className="card-header"><h2 className="card-title"><User size={14} style={{ display: 'inline', verticalAlign: -2 }} /> Klant</h2></div>
            {order.customer || customerName || order.email ? (
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 600 }}>{customerName || order.email || 'Gast'}</div>
                {order.customer?.company && <div className="muted">{order.customer.company}</div>}
                {(order.customer?.email ?? order.email) && (
                  <div className="muted">{order.customer?.email ?? order.email}</div>
                )}
                {order.customer?.phone && <div className="muted">{order.customer.phone}</div>}
                {order.customerId && (
                  <Link
                    to="/customers/$id"
                    params={{ id: order.customerId }}
                    className="btn btn-ghost btn-sm"
                    style={{ justifyContent: 'flex-start', marginTop: 8 }}
                  >
                    Bekijk klant-profiel →
                  </Link>
                )}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 13 }}>Gast-order zonder klantkoppeling.</p>
            )}
          </div>

          {/* Adres */}
          <div className="card">
            <div className="card-header"><h2 className="card-title"><MapPin size={14} style={{ display: 'inline', verticalAlign: -2 }} /> Verzendadres</h2></div>
            {order.shippingAddress ? (
              <Address addr={order.shippingAddress} />
            ) : (
              <p className="muted" style={{ fontSize: 13 }}>Geen verzendadres.</p>
            )}
          </div>

          {/* Totalen */}
          <div className="card">
            <div className="card-header"><h2 className="card-title">Totalen</h2></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <Row label="Subtotaal" value={money(order.subtotal)} />
              {Number(order.discountTotal) > 0 && (
                <Row label="Korting" value={`− ${money(order.discountTotal)}`} accent="danger" />
              )}
              <Row label="Verzending" value={money(order.shippingTotal)} />
              <Row label="BTW" value={money(order.taxTotal)} />
              <div className="divider" style={{ margin: '4px 0' }} />
              <Row label="Totaal" value={money(order.grandTotal)} bold />
              <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <FinancialStatusPill status={order.financialStatus} />
                <FulfillmentStatusPill status={order.fulfillmentStatus} />
              </div>
            </div>
          </div>

          {order.note && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Notitie</h2></div>
              <p style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{order.note}</p>
            </div>
          )}

          {/* Acties */}
          <div className="card">
            <div className="card-header"><h2 className="card-title">Acties</h2></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button type="button" className="btn btn-secondary btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => setStatusOpen(true)} disabled={!canChangeStatus}>
                <ArrowRightLeft size={13} /> Status wijzigen
              </button>
              <button type="button" className="btn btn-secondary btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => setPaymentOpen(true)}>
                <CreditCard size={13} /> Betaling toevoegen
              </button>
              <button type="button" className="btn btn-secondary btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => setFulfillOpen(true)}>
                <Truck size={13} /> Fulfilment aanmaken
              </button>
              <button type="button" className="btn btn-secondary btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => setReturnOpen(true)}>
                <RotateCcw size={13} /> Retour aanmaken
              </button>
            </div>
          </div>
        </div>
      </div>

      <StatusModal open={statusOpen} onClose={() => setStatusOpen(false)} order={order} />
      <FulfillmentModal open={fulfillOpen} onClose={() => setFulfillOpen(false)} order={order} />
      <PaymentModal open={paymentOpen} onClose={() => setPaymentOpen(false)} order={order} />
      <ReturnModal open={returnOpen} onClose={() => setReturnOpen(false)} order={order} />
    </div>
  );
}

function BackLink() {
  return (
    <div style={{ marginBottom: 8 }}>
      <Link to="/orders" className="btn btn-ghost btn-sm" style={{ paddingLeft: 6 }}>
        <ChevronLeft size={14} /> Terug naar orders
      </Link>
    </div>
  );
}

function ItemRow({ item }: { item: OrderItemDto }) {
  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 6, display: 'grid', placeItems: 'center',
            background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', color: 'var(--text-faint)', flexShrink: 0,
          }}>
            <Package size={15} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{item.title ?? item.sku ?? 'Item'}</div>
            <div className="mono" style={{ color: 'var(--theme-muted)', fontSize: 11.5 }}>
              {item.sku ?? '—'} • BTW {item.taxRate}%
            </div>
          </div>
        </div>
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{item.quantity}×</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(item.unitPrice)}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-muted)' }}>
        {item.costPrice ? money(item.costPrice) : '—'}
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: item.margin ? 'var(--success)' : 'var(--text-faint)' }}>
        {item.margin ? `${money(item.margin)} (${marginPct(item.marginPct)})` : '—'}
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(item.lineTotal)}</td>
    </tr>
  );
}

function Address({ addr }: { addr: OrderAddress }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.55 }}>
      {addr.name && <div style={{ fontWeight: 600 }}>{addr.name}</div>}
      {addr.company && <div className="muted">{addr.company}</div>}
      {addr.line1 && <div className="muted">{addr.line1}</div>}
      {addr.line2 && <div className="muted">{addr.line2}</div>}
      <div className="muted">{[addr.postcode, addr.city].filter(Boolean).join(' ')}</div>
      {addr.country && <div className="muted">{addr.country}</div>}
      {addr.phone && <div className="muted">{addr.phone}</div>}
    </div>
  );
}

function Row({ label, value, bold = false, accent }: {
  label: string; value: string; bold?: boolean; accent?: 'danger';
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <span style={{ color: 'var(--theme-muted)' }}>{label}</span>
      <span style={{
        fontWeight: bold ? 700 : 500,
        fontSize: bold ? 14 : 13,
        color: accent === 'danger' ? 'var(--danger)' : 'var(--theme-text)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
};
