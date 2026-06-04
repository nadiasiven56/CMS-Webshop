/**
 * P&L-tabel — winst-en-verlies-overzicht voor de gekozen periode.
 * Pure presentational; voedt zich met de `/api/finance/pnl`-response.
 */
import { formatMoney, formatPct } from '@/lib/format';
import { money, type PnlResponse } from './api';

interface Row {
  label: string;
  value: number;
  kind?: 'positive' | 'negative' | 'total' | 'muted' | 'accent';
  hint?: string;
}

export function PnlTable({ pnl }: { pnl: PnlResponse }) {
  const revenue = money(pnl.revenueNet);
  const cogs = money(pnl.cogs);
  const margin = money(pnl.grossMargin);
  const vat = money(pnl.vat);
  const shipping = money(pnl.shipping);
  const discount = money(pnl.discount);
  const grand = money(pnl.grandTotal);

  const rows: Row[] = [
    { label: 'Omzet (netto, excl. BTW)', value: revenue, kind: 'positive', hint: `${pnl.orderCount} orders` },
    { label: 'Inkoopwaarde verkocht (COGS)', value: -cogs, kind: 'negative' },
    { label: 'Bruto-marge', value: margin, kind: 'total', hint: formatPct(pnl.grossMarginPct) },
    { label: 'Verzendopbrengst', value: shipping, kind: 'muted' },
    { label: 'Verstrekte korting', value: -discount, kind: 'muted' },
    { label: 'BTW (af te dragen)', value: vat, kind: 'muted' },
    { label: 'Bruto-omzet (incl. BTW)', value: grand, kind: 'accent' },
  ];

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Post</th>
            <th style={{ textAlign: 'right' }}>Bedrag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.label}
              style={
                r.kind === 'total' || r.kind === 'accent'
                  ? { borderTop: '1px solid var(--border-default)', background: 'var(--surface-2)' }
                  : undefined
              }
            >
              <td style={{ fontWeight: r.kind === 'total' || r.kind === 'accent' ? 600 : 400 }}>
                {r.label}
                {r.hint && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-faint)' }}>
                    {r.hint}
                  </span>
                )}
              </td>
              <td
                style={{
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: r.kind === 'total' || r.kind === 'accent' ? 700 : 500,
                  color:
                    r.kind === 'positive'
                      ? 'var(--success)'
                      : r.kind === 'negative'
                        ? 'var(--warning)'
                        : r.kind === 'total'
                          ? 'var(--success)'
                          : r.kind === 'accent'
                            ? 'var(--theme-accent)'
                            : 'var(--theme-text)',
                }}
              >
                {r.value < 0 ? '− ' : ''}
                {formatMoney(Math.abs(r.value))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
