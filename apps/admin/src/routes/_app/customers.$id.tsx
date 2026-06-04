/**
 * /customers/:id — klant-detail (echte API).
 *
 * - KPI's: orders_count + total_spent (denormalized op de customers-tabel).
 * - Klant-velden, bewerkbaar via edit-drawer (PATCH /api/customers/:id).
 * - Adressen-CRUD (billing/shipping, is_default) via AddressDrawer.
 * - Orders-historie (read-only, GET /api/customers/:id/orders).
 * - Verwijderen via ConfirmDialog (DELETE /api/customers/:id) → terug naar lijst.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ChevronLeft,
  Mail,
  Phone,
  Building2,
  Edit3,
  Trash2,
  Plus,
  MapPin,
  ShoppingBag,
  Wallet,
  Tag,
  Pencil,
  Star,
} from 'lucide-react';
import {
  useCustomerDetail,
  useCustomerOrders,
  useDeleteCustomer,
  useDeleteAddress,
  customerName,
  isB2B,
  type CustomerAddressDto,
} from '@/components/customers/api';
import { CustomerDrawer } from '@/components/customers/CustomerDrawer';
import { AddressDrawer } from '@/components/customers/AddressDrawer';
import { KpiCard } from '@/components/ui/KpiCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton, SkeletonRows } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastBus } from '@/components/ui/Toast';
import { asApiError } from '@/lib/api';
import { formatMoney, formatDate, formatRelative, initials } from '@/lib/format';

export const Route = createFileRoute('/_app/customers/$id')({
  component: CustomerDetailPage,
});

const ORDERS_PAGE_SIZE = 20;

function money(value: string | null): string {
  return formatMoney(Number(value ?? 0));
}

function CustomerDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const detail = useCustomerDetail(id);
  const [ordersOffset, setOrdersOffset] = useState(0);
  const ordersQuery = useCustomerOrders(id, {
    limit: ORDERS_PAGE_SIZE,
    offset: ordersOffset,
  });

  const deleteCustomer = useDeleteCustomer();
  const deleteAddress = useDeleteAddress(id);

  // Drawer / dialog-state.
  const [editOpen, setEditOpen] = useState(false);
  const [addrCreateOpen, setAddrCreateOpen] = useState(false);
  const [addrEdit, setAddrEdit] = useState<CustomerAddressDto | null>(null);
  const [confirmDeleteCustomer, setConfirmDeleteCustomer] = useState(false);
  const [confirmDeleteAddr, setConfirmDeleteAddr] = useState<CustomerAddressDto | null>(null);

  if (detail.isLoading) {
    return (
      <div>
        <BackLink />
        <Skeleton height={40} width={280} style={{ marginBottom: 16 }} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </div>
        <SkeletonRows rows={5} height={24} />
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    const e = detail.error ? asApiError(detail.error) : null;
    return (
      <div>
        <BackLink />
        <EmptyState
          icon={Mail}
          title={e?.status === 404 ? 'Klant niet gevonden' : 'Kon klant niet laden'}
          description={
            e?.status === 404
              ? 'De klant is mogelijk verwijderd.'
              : 'Er ging iets mis bij het laden. Probeer een refresh.'
          }
          action={
            <Link to="/customers" className="btn btn-secondary">
              Terug naar klanten
            </Link>
          }
        />
      </div>
    );
  }

  const { customer, addresses } = detail.data;
  const name = customerName(customer);
  const b2b = isB2B(customer);

  const orders = ordersQuery.data?.items ?? [];
  const ordersTotal = ordersQuery.data?.total ?? 0;

  function onDeleteCustomer() {
    deleteCustomer.mutate(customer.id, {
      onSuccess: () => {
        toastBus.push('success', `Klant ${customer.email} verwijderd`);
        void navigate({ to: '/customers' });
      },
      onError: (err) => {
        const e = asApiError(err);
        toastBus.push(
          'error',
          e.status === 404 ? 'Klant bestond al niet meer.' : 'Verwijderen mislukt.',
        );
      },
    });
  }

  function onDeleteAddress(addr: CustomerAddressDto) {
    deleteAddress.mutate(addr.id, {
      onSuccess: () => toastBus.push('success', 'Adres verwijderd'),
      onError: () => toastBus.push('error', 'Adres verwijderen mislukt.'),
    });
  }

  return (
    <div>
      <BackLink />

      <header className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="avatar" style={{ width: 44, height: 44, fontSize: 15 }}>
              {initials(name)}
            </div>
            <div>
              <div className="page-title-row">
                <h1 className="page-title">{name}</h1>
                {b2b ? (
                  <span className="badge badge-accent">B2B</span>
                ) : (
                  <span className="badge">B2C</span>
                )}
              </div>
              <p className="page-subtitle" style={{ margin: 0 }}>
                Klant sinds {formatDate(customer.createdAt)}
              </p>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setEditOpen(true)}
          >
            <Edit3 size={14} /> Bewerken
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirmDeleteCustomer(true)}
          >
            <Trash2 size={14} /> Verwijderen
          </button>
        </div>
      </header>

      {/* KPI's */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <KpiCard label="Orders" value={customer.ordersCount} icon={ShoppingBag} />
        <KpiCard label="Totaal besteed" value={money(customer.totalSpent)} icon={Wallet} />
        <KpiCard
          label="Marketing"
          value={customer.acceptsMarketing ? 'Opt-in' : 'Opt-out'}
          icon={Mail}
        />
      </div>

      <div className="detail-grid">
        {/* Main column */}
        <div className="section-stack">
          {/* Adressen */}
          <div className="card card-flush">
            <div
              className="card-header"
              style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-default)' }}
            >
              <h2 className="card-title">
                <MapPin size={14} style={{ display: 'inline', verticalAlign: -2 }} /> Adressen
                <span className="count-badge" style={{ marginLeft: 8 }}>
                  {addresses.length}
                </span>
              </h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setAddrCreateOpen(true)}
              >
                <Plus size={13} /> Adres
              </button>
            </div>

            {addresses.length === 0 ? (
              <div style={{ padding: 20 }}>
                <EmptyState
                  icon={MapPin}
                  title="Nog geen adressen"
                  description="Voeg een verzend- of factuuradres toe."
                />
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: 12,
                  padding: 16,
                }}
              >
                {addresses.map((a) => (
                  <AddressCard
                    key={a.id}
                    address={a}
                    onEdit={() => setAddrEdit(a)}
                    onDelete={() => setConfirmDeleteAddr(a)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Orders-historie */}
          <div className="card card-flush">
            <div
              className="card-header"
              style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-default)' }}
            >
              <h2 className="card-title">
                <ShoppingBag size={14} style={{ display: 'inline', verticalAlign: -2 }} />{' '}
                Orders
                <span className="count-badge" style={{ marginLeft: 8 }}>
                  {ordersTotal}
                </span>
              </h2>
            </div>

            {ordersQuery.isLoading ? (
              <div style={{ padding: 16 }}>
                <SkeletonRows rows={4} height={22} />
              </div>
            ) : ordersQuery.isError ? (
              <div style={{ padding: 20 }}>
                <p className="error-text">Kon order-historie niet laden.</p>
              </div>
            ) : orders.length === 0 ? (
              <div style={{ padding: 20 }}>
                <EmptyState
                  icon={ShoppingBag}
                  title="Geen orders"
                  description="Deze klant heeft nog geen bestellingen geplaatst."
                />
              </div>
            ) : (
              <>
                <table className="table" style={{ borderRadius: 0 }}>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Kanaal</th>
                      <th>Status</th>
                      <th>Betaling</th>
                      <th>Datum</th>
                      <th style={{ textAlign: 'right' }}>Totaal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <span
                            className="mono"
                            style={{ color: 'var(--theme-accent)', fontWeight: 600 }}
                          >
                            {o.orderNumber}
                          </span>
                        </td>
                        <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>
                          {o.channel}
                        </td>
                        <td>
                          <span className="badge">{o.status}</span>
                        </td>
                        <td>
                          <span className="badge">{o.financialStatus}</span>
                        </td>
                        <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>
                          {formatDate(o.placedAt ?? o.createdAt)}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 600,
                          }}
                        >
                          {money(o.grandTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {ordersTotal > ORDERS_PAGE_SIZE && (
                  <div
                    style={{
                      padding: '12px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <span className="muted" style={{ fontSize: 13 }}>
                      {ordersOffset + 1}–{Math.min(ordersOffset + ORDERS_PAGE_SIZE, ordersTotal)} van{' '}
                      {ordersTotal}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={ordersOffset === 0}
                        onClick={() =>
                          setOrdersOffset(Math.max(0, ordersOffset - ORDERS_PAGE_SIZE))
                        }
                      >
                        Vorige
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={ordersOffset + ORDERS_PAGE_SIZE >= ordersTotal}
                        onClick={() => setOrdersOffset(ordersOffset + ORDERS_PAGE_SIZE)}
                      >
                        Volgende
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Aside */}
        <div className="aside-stack">
          {/* Contact-card */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Contact</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setEditOpen(true)}
                aria-label="Bewerk klant"
                style={{ width: 28, height: 28 }}
              >
                <Pencil size={13} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <DetailRow icon={<Mail size={13} />} value={customer.email} />
              {customer.phone && (
                <DetailRow icon={<Phone size={13} />} value={customer.phone} />
              )}
              {customer.company && (
                <DetailRow icon={<Building2 size={13} />} value={customer.company} />
              )}
              {b2b && customer.vatNumber && (
                <DetailRow
                  icon={<Building2 size={13} />}
                  value={<span className="mono">{customer.vatNumber}</span>}
                />
              )}
            </div>
          </div>

          {/* Tags */}
          {customer.tags.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <Tag size={13} style={{ display: 'inline', verticalAlign: -2 }} /> Tags
                </h2>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {customer.tags.map((t) => (
                  <span key={t} className="badge badge-info">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notitie */}
          {customer.notes && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Notitie</h2>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-soft)',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {customer.notes}
              </div>
            </div>
          )}

          {/* Meta */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Details</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <MetaRow label="Aangemaakt" value={formatDate(customer.createdAt)} />
              <MetaRow label="Laatst gewijzigd" value={formatRelative(customer.updatedAt)} />
            </div>
          </div>
        </div>
      </div>

      {/* Drawers + dialogs */}
      <CustomerDrawer
        mode="edit"
        open={editOpen}
        customer={customer}
        onClose={() => setEditOpen(false)}
      />
      <AddressDrawer
        mode="create"
        open={addrCreateOpen}
        customerId={customer.id}
        onClose={() => setAddrCreateOpen(false)}
      />
      {addrEdit && (
        <AddressDrawer
          mode="edit"
          open={true}
          customerId={customer.id}
          address={addrEdit}
          onClose={() => setAddrEdit(null)}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteCustomer}
        onClose={() => setConfirmDeleteCustomer(false)}
        onConfirm={onDeleteCustomer}
        title="Klant verwijderen?"
        message={
          <>
            <strong>{name}</strong> wordt permanent verwijderd. Adressen worden
            mee-verwijderd; bestaande orders blijven bestaan maar verliezen de
            klant-koppeling. Dit kan niet ongedaan gemaakt worden.
          </>
        }
        confirmLabel="Verwijder"
      />
      <ConfirmDialog
        open={confirmDeleteAddr !== null}
        onClose={() => setConfirmDeleteAddr(null)}
        onConfirm={() => {
          if (confirmDeleteAddr) onDeleteAddress(confirmDeleteAddr);
        }}
        title="Adres verwijderen?"
        message="Dit adres wordt verwijderd. Dit kan niet ongedaan gemaakt worden."
        confirmLabel="Verwijder"
      />
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function BackLink() {
  return (
    <div style={{ marginBottom: 8 }}>
      <Link to="/customers" className="btn btn-ghost btn-sm" style={{ paddingLeft: 6 }}>
        <ChevronLeft size={14} />
        Terug naar klanten
      </Link>
    </div>
  );
}

function AddressCard({
  address,
  onEdit,
  onDelete,
}: {
  address: CustomerAddressDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const typeLabel = address.type === 'billing' ? 'Facturatie' : 'Verzending';
  return (
    <div
      className="card"
      style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className={`badge ${address.type === 'billing' ? 'badge-info' : ''}`}>
          {typeLabel}
        </span>
        {address.isDefault && (
          <span
            className="badge badge-accent"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
          >
            <Star size={10} /> Standaard
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          <button
            type="button"
            className="icon-btn"
            onClick={onEdit}
            aria-label="Bewerk adres"
            style={{ width: 26, height: 26 }}
          >
            <Edit3 size={12} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onDelete}
            aria-label="Verwijder adres"
            style={{ width: 26, height: 26 }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-soft)' }}>
        {address.name && <div style={{ fontWeight: 600, color: 'var(--theme-text)' }}>{address.name}</div>}
        {address.line1 && <div>{address.line1}</div>}
        {address.line2 && <div>{address.line2}</div>}
        <div>
          {[address.postcode, address.city].filter(Boolean).join(' ')}
        </div>
        <div>{[address.province, address.country].filter(Boolean).join(', ')}</div>
        {address.phone && (
          <div style={{ color: 'var(--theme-muted)', marginTop: 2 }}>{address.phone}</div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ icon, value }: { icon: React.ReactNode; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: 'var(--theme-muted)', display: 'inline-grid', placeItems: 'center' }}>
        {icon}
      </span>
      <span style={{ wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: 'var(--theme-muted)' }}>{label}</span>
      <span style={{ color: 'var(--theme-text)' }}>{value}</span>
    </div>
  );
}
