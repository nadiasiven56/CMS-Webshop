/**
 * Invoice-detail-drawer — toont factuurregels, klant + totalen en biedt de
 * UBL-XML-download (`/api/finance/exports/ubl`). ESC + backdrop sluiten via de
 * gedeelde Drawer-component.
 */
import type { ReactNode } from 'react';
import { Download, FileX2 } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoney, formatDate } from '@/lib/format';
import { downloadBlob } from '@/lib/downloads';
import { toast } from '@/lib/toast';
import { useInvoiceDetail, useUblExport, money, type InvoiceDto } from './api';

interface Props {
  invoice: InvoiceDto | null;
  onClose: () => void;
}

export function InvoiceDrawer({ invoice, onClose }: Props) {
  const detail = useInvoiceDetail(invoice?.id ?? null);
  const ublExport = useUblExport();

  const inv = detail.data ?? invoice;

  function exportUbl() {
    if (!invoice) return;
    ublExport.mutate(
      { invoiceId: invoice.id, persist: true },
      {
        onSuccess: (xml) => {
          downloadBlob(`${invoice.invoiceNumber}.xml`, xml, 'application/xml');
          toast.success(`UBL-XML gedownload voor ${invoice.invoiceNumber}`);
          void detail.refetch();
        },
        onError: () => toast.error('UBL-export mislukt'),
      },
    );
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      issued: 'badge-info',
      paid: 'badge-success',
      sent: 'badge-accent',
      draft: 'badge-neutral',
      cancelled: 'badge-danger',
    };
    return <span className={`badge ${map[status] ?? 'badge-neutral'}`}>{status}</span>;
  };

  return (
    <Drawer
      open={invoice !== null}
      onClose={onClose}
      title={invoice ? `Factuur ${invoice.invoiceNumber}` : ''}
      subtitle={invoice ? `${invoice.type === 'credit' ? 'Creditfactuur' : 'Verkoopfactuur'} · ${formatDate(invoice.issuedAt)}` : undefined}
      width={520}
      footer={
        invoice && (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Sluiten
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={exportUbl}
              disabled={ublExport.isPending}
            >
              <Download size={14} />
              {ublExport.isPending ? 'Genereren…' : 'UBL-XML downloaden'}
            </button>
          </>
        )
      }
    >
      {!inv ? (
        <Skeleton height={300} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Status + klant */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {statusBadge(inv.status)}
            {inv.hasUblXml && <span className="badge badge-success">UBL aanwezig</span>}
          </div>

          <section>
            <SectionLabel>Klant</SectionLabel>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600 }}>
                {inv.customer?.name ?? inv.customer?.company ?? 'Onbekend'}
              </div>
              {inv.customer?.company && inv.customer?.name && (
                <div style={{ color: 'var(--theme-muted)' }}>{inv.customer.company}</div>
              )}
              {inv.customer?.vatNumber && (
                <div style={{ color: 'var(--theme-muted)' }}>BTW: {inv.customer.vatNumber}</div>
              )}
              {inv.customer?.email && (
                <div style={{ color: 'var(--theme-muted)' }}>{inv.customer.email}</div>
              )}
              {inv.customer?.address && (
                <div style={{ color: 'var(--theme-muted)', marginTop: 4 }}>
                  {inv.customer.address.line1}
                  {inv.customer.address.postcode || inv.customer.address.city ? (
                    <>
                      <br />
                      {inv.customer.address.postcode} {inv.customer.address.city}
                    </>
                  ) : null}
                  {inv.customer.address.country ? (
                    <>
                      <br />
                      {inv.customer.address.country}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          {/* Regels */}
          <section>
            <SectionLabel>Regels</SectionLabel>
            {inv.lines.length === 0 ? (
              <p className="muted" style={{ fontSize: 12.5 }}>Geen regels.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Omschrijving</th>
                      <th style={{ textAlign: 'right' }}>Aantal</th>
                      <th style={{ textAlign: 'right' }}>BTW</th>
                      <th style={{ textAlign: 'right' }}>Totaal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((l, i) => (
                      <tr key={l.id ?? i}>
                        <td>
                          <div>{l.title ?? l.sku ?? `Regel ${i + 1}`}</div>
                          {l.sku && (
                            <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
                              {l.sku}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {l.quantity ?? '—'}×
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-muted)' }}>
                          {l.taxRate != null ? `${l.taxRate}%` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {l.lineTotal != null ? formatMoney(money(l.lineTotal)) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Totalen */}
          <section>
            <SectionLabel>Totalen</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <TotalRow label="Subtotaal (excl. BTW)" value={inv.subtotal} />
              <TotalRow label="BTW" value={inv.vatTotal} />
              <TotalRow label="Totaal" value={inv.total} strong accent />
            </div>
          </section>

          {!inv.hasUblXml && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                fontSize: 12,
                color: 'var(--theme-muted)',
                padding: '8px 10px',
                background: 'var(--surface-2)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
              }}
            >
              <FileX2 size={14} />
              Nog geen UBL-XML gegenereerd — klik op "UBL-XML downloaden" om aan te maken.
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--text-faint)',
        margin: '0 0 8px',
      }}
    >
      {children}
    </h3>
  );
}

function TotalRow({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string | null;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: strong ? '8px 0 0' : '2px 0',
        borderTop: strong ? '1px solid var(--border-default)' : undefined,
        fontSize: 13,
      }}
    >
      <span style={{ color: 'var(--theme-muted)', fontWeight: strong ? 600 : 400 }}>{label}</span>
      <span
        style={{
          fontVariantNumeric: 'tabular-nums',
          fontWeight: strong ? 700 : 500,
          color: accent ? 'var(--theme-accent)' : 'var(--theme-text)',
        }}
      >
        {value != null ? formatMoney(money(value)) : '—'}
      </span>
    </div>
  );
}
