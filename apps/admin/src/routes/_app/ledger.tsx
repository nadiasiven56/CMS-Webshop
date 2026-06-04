/**
 * /ledger — grootboek (echte data, shop-scoped).
 *
 * Bron: GET /api/finance/ledger (paginated + filters account/channel/from/to).
 * Toont per-mutatie debet/credit + totalen onder de tabel. Klik op een rij →
 * detail-Modal.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, Search, BarChart3 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  useLedger,
  money,
  channelLabel,
  SALES_CHANNELS,
  type LedgerEntryDto,
} from '@/components/finance/api';
import { useActiveShop } from '@/lib/shop-context';
import { formatMoney, formatDate } from '@/lib/format';

export const Route = createFileRoute('/_app/ledger')({
  component: LedgerPage,
});

const PAGE_SIZE = 100;

/** Bekende grootboek-accounts (uit backend ledger_entries.account). */
const ACCOUNTS: Array<{ value: string; label: string }> = [
  { value: 'revenue', label: 'Omzet' },
  { value: 'vat_payable', label: 'BTW af te dragen' },
  { value: 'cogs', label: 'Inkoopwaarde (COGS)' },
  { value: 'receivable', label: 'Debiteuren' },
  { value: 'refund', label: 'Terugbetalingen' },
  { value: 'shipping', label: 'Verzending' },
];

const ACCOUNT_LABEL: Record<string, string> = Object.fromEntries(
  ACCOUNTS.map((a) => [a.value, a.label]),
);

function LedgerPage() {
  const { activeShopId } = useActiveShop();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState('');
  const [channel, setChannel] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [entry, setEntry] = useState<LedgerEntryDto | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useLedger(activeShopId, {
    account: account || undefined,
    channel: channel || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: PAGE_SIZE,
    offset: 0,
  });

  const items = query.data?.items ?? [];

  // Client-side zoekfilter (op ref/description/account) op de geladen page.
  const filtered = useMemo(() => {
    if (!search) return items;
    return items.filter((e) => {
      const hay = `${e.description ?? ''} ${e.account} ${e.orderId ?? ''} ${e.channel ?? ''}`.toLowerCase();
      return hay.includes(search);
    });
  }, [items, search]);

  // Totalen onder de tabel.
  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const e of filtered) {
      debit += money(e.debit);
      credit += money(e.credit);
    }
    return { debit, credit, net: debit - credit };
  }, [filtered]);

  const hasFilters = !!(account || channel || from || to || search);

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Grootboek</h1>
          <p className="page-subtitle">Journaalposten — omzet, BTW, COGS en correcties.</p>
        </div>
        <Link to="/finance" className="btn btn-secondary">
          <BarChart3 size={14} /> Dashboard
        </Link>
      </header>

      {/* Filterbar */}
      <div className="toolbar" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="search-input">
          <Search size={14} />
          <input
            placeholder="Zoek op order, account of omschrijving…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <select
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 12.5 }}
          aria-label="Account"
        >
          <option value="">Alle accounts</option>
          {ACCOUNTS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 12.5 }}
          aria-label="Kanaal"
        >
          <option value="">Alle kanalen</option>
          {SALES_CHANNELS.map((ch) => (
            <option key={ch.value} value={ch.value}>
              {ch.label}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--theme-muted)' }}>
          Van
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ padding: '5px 8px', fontSize: 12.5 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--theme-muted)' }}>
          Tot
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ padding: '5px 8px', fontSize: 12.5 }}
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setAccount('');
              setChannel('');
              setFrom('');
              setTo('');
              setSearch('');
              setSearchInput('');
            }}
          >
            Wis filters
          </button>
        )}
      </div>

      {!activeShopId ? (
        <EmptyState icon={BookOpenCheck} title="Geen shop geselecteerd" description="Kies een shop in de bovenbalk." />
      ) : query.isError ? (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <p className="error-text" style={{ color: 'var(--danger)' }}>
            Kon grootboek niet laden. Probeer een pagina-refresh.
          </p>
        </div>
      ) : query.isLoading ? (
        <Skeleton height={360} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={hasFilters ? Search : BookOpenCheck}
          title={hasFilters ? 'Geen mutaties gevonden' : 'Nog geen journaalposten'}
          description={
            hasFilters
              ? 'Pas je filters aan of kies een ander datumbereik.'
              : 'Zodra orders worden afgerekend verschijnen hier de boekingen.'
          }
        />
      ) : (
        <div className="card card-flush">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Account</th>
                  <th style={{ textAlign: 'right' }}>Debet</th>
                  <th style={{ textAlign: 'right' }}>Credit</th>
                  <th>Omschrijving</th>
                  <th>Kanaal</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} onClick={() => setEntry(e)} style={{ cursor: 'pointer' }}>
                    <td
                      style={{
                        fontSize: 12.5,
                        color: 'var(--theme-muted)',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatDate(e.entryDate)}
                    </td>
                    <td>
                      <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>
                        {ACCOUNT_LABEL[e.account] ?? e.account}
                      </span>
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: money(e.debit) > 0 ? 'var(--success)' : 'var(--text-faint)',
                      }}
                    >
                      {money(e.debit) > 0 ? formatMoney(money(e.debit)) : '—'}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: money(e.credit) > 0 ? 'var(--warning)' : 'var(--text-faint)',
                      }}
                    >
                      {money(e.credit) > 0 ? formatMoney(money(e.credit)) : '—'}
                    </td>
                    <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>
                      {e.description ?? '—'}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{e.channel ? channelLabel(e.channel) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border-default)', background: 'var(--surface-2)' }}>
                  <td colSpan={2} style={{ fontWeight: 600 }}>
                    Totaal ({filtered.length} regels)
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--success)' }}>
                    {formatMoney(totals.debit)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--warning)' }}>
                    {formatMoney(totals.credit)}
                  </td>
                  <td colSpan={2} style={{ textAlign: 'right', fontSize: 12, color: 'var(--theme-muted)' }}>
                    Saldo {formatMoney(Math.abs(totals.net))} {totals.net >= 0 ? 'DR' : 'CR'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {query.data && query.data.total > filtered.length && (
            <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-faint)' }}>
              Toont eerste {filtered.length} van {query.data.total} mutaties. Verfijn met filters voor
              specifieke posten.
            </div>
          )}
        </div>
      )}

      <Modal
        open={entry !== null}
        onClose={() => setEntry(null)}
        title={entry ? (ACCOUNT_LABEL[entry.account] ?? entry.account) : ''}
        subtitle={entry ? formatDate(entry.entryDate) : undefined}
      >
        {entry && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <DetailRow label="Account" value={`${ACCOUNT_LABEL[entry.account] ?? entry.account} (${entry.account})`} />
            <DetailRow label="Omschrijving" value={entry.description ?? '—'} />
            <DetailRow
              label="Debet"
              value={money(entry.debit) > 0 ? formatMoney(money(entry.debit)) : '—'}
              accent={money(entry.debit) > 0 ? 'success' : undefined}
            />
            <DetailRow
              label="Credit"
              value={money(entry.credit) > 0 ? formatMoney(money(entry.credit)) : '—'}
              accent={money(entry.credit) > 0 ? 'warning' : undefined}
            />
            {entry.channel && <DetailRow label="Kanaal" value={channelLabel(entry.channel)} />}
            {entry.vatRate && <DetailRow label="BTW-tarief" value={`${entry.vatRate}%`} />}
            {entry.vatCountry && <DetailRow label="Land" value={entry.vatCountry} />}
            {entry.orderId && <DetailRow label="Order-ID" value={entry.orderId} mono />}
            <DetailRow label="Valuta" value={entry.currency} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function DetailRow({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: string;
  accent?: 'success' | 'warning';
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
      }}
    >
      <span style={{ color: 'var(--theme-muted)' }}>{label}</span>
      <span
        className={mono ? 'mono' : undefined}
        style={{
          fontWeight: 500,
          textAlign: 'right',
          color:
            accent === 'success'
              ? 'var(--success)'
              : accent === 'warning'
                ? 'var(--warning)'
                : 'var(--theme-text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}
