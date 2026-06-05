/**
 * /accounting — boekhouding: exports + facturen (echte data, shop-scoped).
 *
 * Bronnen:
 *   - GET  /api/finance/invoices            (facturenlijst)
 *   - POST /api/finance/exports/oss         (OSS-CSV per kwartaal — download)
 *   - POST /api/finance/exports/ubl         (UBL-XML per factuur — via InvoiceDrawer)
 *
 * Geld via formatMoney(money(x)). Downloads via lib/downloads.ts.
 *
 * NB: dit is de INDEX-route van /accounting (layout = accounting.tsx, pure <Outlet/>).
 * De boekhoud-koppeling-pagina (connect/sync) leeft op /accounting/koppelingen.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { ChevronLeft, Download, FileText, Receipt } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ClickableRow } from '@/components/ui/ClickableRow';
import { InvoiceDrawer } from '@/components/finance/InvoiceDrawer';
import {
  useInvoices,
  useOssExport,
  money,
  type InvoiceDto,
} from '@/components/finance/api';
import { useActiveShop } from '@/lib/shop-context';
import { formatMoney, formatDate } from '@/lib/format';
import { downloadBlob } from '@/lib/downloads';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/accounting/')({
  component: AccountingPage,
});

const TYPE_TABS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Alle' },
  { value: 'sales', label: 'Verkoop' },
  { value: 'credit', label: 'Credit' },
];

/** Laatste 4 kwartalen (incl. huidig) als OSS-export-opties. */
function recentQuarters(count = 4): string[] {
  const out: string[] = [];
  const now = new Date();
  let year = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;
  for (let i = 0; i < count; i++) {
    out.push(`${year}-Q${q}`);
    q -= 1;
    if (q < 1) {
      q = 4;
      year -= 1;
    }
  }
  return out;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    issued: 'badge-info',
    paid: 'badge-success',
    sent: 'badge-accent',
    draft: 'badge-neutral',
    cancelled: 'badge-danger',
  };
  return <span className={`badge ${map[status] ?? 'badge-neutral'}`}>{status}</span>;
}

function AccountingPage() {
  const { activeShopId, activeShop } = useActiveShop();

  const [type, setType] = useState('');
  const [selected, setSelected] = useState<InvoiceDto | null>(null);
  const [ossPeriod, setOssPeriod] = useState(() => recentQuarters(1)[0]!);

  const quarters = useMemo(() => recentQuarters(4), []);
  const query = useInvoices(activeShopId, { type: type || undefined, limit: 100 });
  const ossExport = useOssExport();

  const items = query.data?.items ?? [];

  function exportOss() {
    ossExport.mutate(
      { period: ossPeriod, shopId: activeShopId },
      {
        onSuccess: (csv) => {
          downloadBlob(`oss-${ossPeriod}.csv`, csv, 'text/csv');
          toast.success(`OSS-CSV ${ossPeriod} gedownload`);
        },
        onError: () => toast.error('OSS-export mislukt'),
      },
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <Link to="/finance" className="btn btn-ghost btn-sm" style={{ paddingLeft: 6 }}>
          <ChevronLeft size={14} />
          Terug naar Financieel
        </Link>
      </div>

      <header className="page-header">
        <div>
          <h1 className="page-title">Boekhouding</h1>
          <p className="page-subtitle">
            Facturen en fiscale exports{activeShop ? ` voor ${activeShop.name}` : ''}.
          </p>
        </div>
      </header>

      {/* Exports */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        {/* OSS-CSV */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                <FileText size={14} style={{ display: 'inline', verticalAlign: -2 }} /> OSS-aangifte
              </h2>
              <p className="card-subtitle">CSV per land + tarief over een kwartaal.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={ossPeriod}
              onChange={(e) => setOssPeriod(e.target.value)}
              style={{ padding: '7px 10px', fontSize: 13 }}
              aria-label="Kwartaal"
            >
              {quarters.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary"
              onClick={exportOss}
              disabled={ossExport.isPending || !activeShopId}
            >
              <Download size={14} />
              {ossExport.isPending ? 'Genereren…' : 'OSS-CSV downloaden'}
            </button>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 10, marginBottom: 0 }}>
            Afgeleid uit grootboek (per vat_country + vat_rate). Klaar voor het Belastingdienst-portal.
          </p>
        </div>

        {/* UBL */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                <Receipt size={14} style={{ display: 'inline', verticalAlign: -2 }} /> UBL e-facturatie
              </h2>
              <p className="card-subtitle">UBL 2.1 (SI-UBL/NLCIUS) per factuur.</p>
            </div>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--theme-muted)', margin: 0 }}>
            Open een factuur uit de lijst hieronder en kies "UBL-XML downloaden". De XML wordt
            opgeslagen op de factuur voor hergebruik.
          </p>
        </div>
      </div>

      {/* Facturen */}
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <h2 className="card-title" style={{ marginRight: 'auto' }}>
          Facturen
        </h2>
        <div className="segmented" role="tablist" aria-label="Factuurtype">
          {TYPE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              data-active={type === t.value}
              onClick={() => setType(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {!activeShopId ? (
        <EmptyState icon={Receipt} title="Geen shop geselecteerd" description="Kies een shop in de bovenbalk." />
      ) : query.isError ? (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <p className="error-text" style={{ color: 'var(--danger)' }}>
            Kon facturen niet laden. Probeer een pagina-refresh.
          </p>
        </div>
      ) : query.isLoading ? (
        <Skeleton height={300} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={type ? 'Geen facturen van dit type' : 'Nog geen facturen'}
          description={
            type
              ? 'Pas het type-filter aan.'
              : 'Facturen worden gegenereerd vanuit afgeronde orders.'
          }
        />
      ) : (
        <div className="card card-flush">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Factuurnr.</th>
                  <th>Type</th>
                  <th>Klant</th>
                  <th>Datum</th>
                  <th style={{ textAlign: 'right' }}>Subtotaal</th>
                  <th style={{ textAlign: 'right' }}>BTW</th>
                  <th style={{ textAlign: 'right' }}>Totaal</th>
                  <th>Status</th>
                  <th>UBL</th>
                </tr>
              </thead>
              <tbody>
                {items.map((inv) => (
                  <ClickableRow
                    key={inv.id}
                    onActivate={() => setSelected(inv)}
                    ariaLabel={`Open factuur ${inv.invoiceNumber}`}
                  >
                    <td className="mono" style={{ fontSize: 12, color: 'var(--theme-accent)', whiteSpace: 'nowrap' }}>
                      {inv.invoiceNumber}
                    </td>
                    <td>
                      <span className={`badge ${inv.type === 'credit' ? 'badge-warning' : 'badge-neutral'}`}>
                        {inv.type === 'credit' ? 'Credit' : 'Verkoop'}
                      </span>
                    </td>
                    <td>{inv.customer?.name ?? inv.customer?.company ?? '—'}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--theme-muted)', whiteSpace: 'nowrap' }}>
                      {formatDate(inv.issuedAt)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(money(inv.subtotal))}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-muted)' }}>
                      {formatMoney(money(inv.vatTotal))}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {formatMoney(money(inv.total))}
                    </td>
                    <td>{statusBadge(inv.status)}</td>
                    <td>
                      {inv.hasUblXml ? (
                        <span className="badge badge-success" style={{ fontSize: 10 }}>
                          ✓
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>—</span>
                      )}
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
          {query.data && query.data.total > items.length && (
            <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-faint)' }}>
              Toont eerste {items.length} van {query.data.total} facturen.
            </div>
          )}
        </div>
      )}

      <InvoiceDrawer invoice={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
