/**
 * /customers — klantenlijst (echte, shop-scoped API).
 *
 * - Zoek op email / naam / company (debounced, server-side ilike).
 * - B2B-badge bij klanten met een btw-nummer.
 * - Paginate (limit/offset), klik op rij → detail (/customers/:id).
 * - Create-klant via edit-drawer.
 *
 * Geen mock-data meer: praat met GET /api/customers (zie components/customers/api.ts).
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Search, Users, Plus, UserPlus } from 'lucide-react';
import {
  useCustomerList,
  customerName,
  isB2B,
  type CustomerDto,
} from '@/components/customers/api';
import { CustomerDrawer } from '@/components/customers/CustomerDrawer';
import { useActiveShop } from '@/lib/shop-context';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { formatMoney, formatRelative, initials } from '@/lib/format';

export const Route = createFileRoute('/_app/customers/')({
  component: CustomersPage,
});

const PAGE_SIZE = 20;

/** Geld-string ("123.4500") → number voor formatMoney. */
function money(value: string | null): string {
  return formatMoney(Number(value ?? 0));
}

function CustomersPage() {
  const navigate = useNavigate();
  const { activeShopId } = useActiveShop();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  // Debounce search.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset pagina bij shop-wissel.
  useEffect(() => {
    setOffset(0);
  }, [activeShopId]);

  const params = useMemo(
    () => ({
      shopId: activeShopId,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [activeShopId, search, offset],
  );

  const query = useCustomerList(params);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function openDetail(c: CustomerDto) {
    void navigate({ to: '/customers/$id', params: { id: c.id } });
  }

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Klanten</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">
            Beheer klanten — B2C en B2B, gescoped op de actieve shop.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-icon-leading"
          onClick={() => setCreateOpen(true)}
          disabled={!activeShopId}
        >
          <Plus size={14} />
          Klant toevoegen
        </button>
      </header>

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div className="search-input">
          <Search size={14} />
          <input
            aria-label="Zoek klanten"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Zoek op naam, e-mail of bedrijf…"
          />
        </div>
      </div>

      {!activeShopId ? (
        <EmptyState
          icon={Users}
          title="Geen shop geselecteerd"
          description="Kies een shop in de bovenbalk om klanten te bekijken."
        />
      ) : query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">
            Kon klanten niet laden. Probeer een pagina-refresh.
          </p>
        </div>
      ) : query.isLoading ? (
        <SkeletonTableRows rows={8} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={search ? Search : UserPlus}
          title={search ? 'Geen klanten gevonden' : 'Nog geen klanten'}
          description={
            search
              ? 'Probeer een andere zoekterm.'
              : 'Voeg je eerste klant toe om te beginnen.'
          }
          action={
            !search ? (
              <button
                type="button"
                className="btn btn-primary btn-icon-leading"
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={14} />
                Klant toevoegen
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
                  <th>Klant</th>
                  <th>E-mail</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Orders</th>
                  <th style={{ textAlign: 'right' }}>Besteed</th>
                  <th>Aangemaakt</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const name = customerName(c);
                  const b2b = isB2B(c);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => openDetail(c)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            className="avatar"
                            style={{ width: 30, height: 30, fontSize: 11 }}
                          >
                            {initials(name)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 500 }}>{name}</div>
                            {c.company && (
                              <div
                                style={{
                                  fontSize: 11.5,
                                  color: 'var(--theme-muted)',
                                }}
                              >
                                {c.company}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>
                        {c.email}
                      </td>
                      <td>
                        {b2b ? (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 3,
                            }}
                          >
                            <span className="badge badge-accent">B2B</span>
                            {c.vatNumber && (
                              <span
                                className="mono"
                                style={{
                                  fontSize: 10.5,
                                  color: 'var(--theme-muted)',
                                }}
                              >
                                {c.vatNumber}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="badge">B2C</span>
                        )}
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {c.ordersCount}
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 600,
                        }}
                      >
                        {money(c.totalSpent)}
                      </td>
                      <td>
                        <div style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>
                          {formatRelative(c.createdAt)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {total > PAGE_SIZE && !query.isLoading && (
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span className="muted" style={{ fontSize: 13 }}>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} van {total}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Vorige
            </button>
            <span
              className="muted"
              style={{ alignSelf: 'center', fontSize: 13 }}
            >
              Pagina {page} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Volgende
            </button>
          </div>
        </div>
      )}

      <CustomerDrawer
        mode="create"
        open={createOpen}
        shopId={activeShopId}
        onClose={() => setCreateOpen(false)}
        onSaved={(c) => openDetail(c)}
      />
    </div>
  );
}
