import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, MapPin } from 'lucide-react';
import { StockBar } from '@/components/ui/StockBar';

export interface StockTableRow {
  itemId: string;
  sku: string;
  productTitle: string | null;
  productId: string | null;
  variantSku: string | null;
  onHandTotal: number;
  availableTotal: number;
  committedTotal: number;
  incomingTotal: number;
  locationsCount: number;
  lowStock: boolean;
}

interface Props {
  rows: StockTableRow[];
  loading?: boolean;
  emptyMessage?: string;
}

export function StockTable({ rows, loading, emptyMessage }: Props) {
  if (loading) {
    return (
      <div className="empty-state" style={{ padding: 24 }}>
        <p className="muted">Laden…</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 24 }}>
        <p className="muted">{emptyMessage ?? 'Geen voorraad-items gevonden.'}</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>SKU</th>
            <th style={{ width: '32%' }}>Product</th>
            <th>Voorraad-niveau</th>
            <th style={{ textAlign: 'right' }}>On hand</th>
            <th style={{ textAlign: 'right' }}>Committed</th>
            <th style={{ textAlign: 'center' }}>Locaties</th>
            <th style={{ textAlign: 'center' }}>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.itemId}>
              <td>
                <Link
                  to="/stock/$itemId"
                  params={{ itemId: row.itemId }}
                  className="mono"
                  style={{
                    color: 'var(--theme-accent)',
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  {row.sku}
                </Link>
              </td>
              <td>
                <div style={{ color: 'var(--theme-text)' }}>
                  {row.productTitle ?? <span className="muted">—</span>}
                </div>
                {row.variantSku && row.variantSku !== row.sku && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                    variant: <code className="mono">{row.variantSku}</code>
                  </div>
                )}
              </td>
              <td style={{ minWidth: 160 }}>
                <StockBar available={row.availableTotal} showLabel={false} />
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {row.onHandTotal}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {row.committedTotal > 0 ? row.committedTotal : <span className="muted">—</span>}
              </td>
              <td style={{ textAlign: 'center' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    color: 'var(--theme-muted)',
                  }}
                >
                  <MapPin size={11} />
                  {row.locationsCount}
                </span>
              </td>
              <td style={{ textAlign: 'center' }}>
                {row.lowStock ? (
                  <span className="badge badge-warning">
                    <AlertTriangle size={11} />
                    Low
                  </span>
                ) : (
                  <span className="badge badge-success">OK</span>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>
                <Link
                  to="/stock/$itemId"
                  params={{ itemId: row.itemId }}
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '4px 8px' }}
                  aria-label="Open"
                >
                  <ArrowRight size={13} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
