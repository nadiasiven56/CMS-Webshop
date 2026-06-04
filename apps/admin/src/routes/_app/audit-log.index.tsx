/**
 * /audit-log (index) — Audit-log op de ECHTE API (`/api/audit`, read-only).
 *
 * Een filterbare tabel (tijd, actor, actie, entityType, entityId) met filters
 * voor entityType + action + datum-range, en een row-click detail-drawer die de
 * before/after-samenvatting + ip toont.
 *
 * NB: de backend geeft GEEN `total` terug — paginatie is offset-gebaseerd op
 * basis van een volle pagina (heeft-meer-heuristiek).
 * Mirror van channels.index.tsx (layout = pure <Outlet/>, deze id eindigt op '/').
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import {
  useAuditLog,
  actionBadgeClass,
  actorLabel,
  AUDIT_ENTITY_TYPES,
  AUDIT_ACTIONS,
  type AuditEntryDto,
  type AuditListFilters,
} from '@/components/audit/api';
import { AuditDetailDrawer } from '@/components/audit/AuditDetailDrawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { formatRelative, formatDateTime, truncate } from '@/lib/format';

export const Route = createFileRoute('/_app/audit-log/')({
  component: AuditLogPage,
});

const PAGE_SIZE = 50;

/** Een datum-input (YYYY-MM-DD) → ISO-grens. `to` wordt naar einde-dag gezet. */
function toIso(date: string, endOfDay = false): string | undefined {
  if (!date) return undefined;
  return endOfDay ? `${date}T23:59:59.999Z` : `${date}T00:00:00.000Z`;
}

function AuditLogPage() {
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AuditEntryDto | null>(null);

  const filters: AuditListFilters = {
    entityType: entityType || undefined,
    action: action || undefined,
    from: toIso(from),
    to: toIso(to, true),
    limit: PAGE_SIZE,
    offset,
  };

  const query = useAuditLog(filters);
  const items = query.data?.items ?? [];
  const hasMore = items.length === PAGE_SIZE;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const hasActiveFilter = Boolean(entityType || action || from || to);

  function setAndReset<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setOffset(0);
    };
  }

  function clearFilters() {
    setEntityType('');
    setAction('');
    setFrom('');
    setTo('');
    setOffset(0);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit-log</h1>
          <p className="page-subtitle">
            Onveranderlijk logboek van alle mutaties — wie, wat, wanneer en vanaf welk IP.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div
        className="toolbar"
        style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'var(--theme-muted)' }}>
          Entiteit
          <select
            value={entityType}
            onChange={(e) => setAndReset(setEntityType)(e.target.value)}
            style={{ padding: '7px 10px', fontSize: 13 }}
          >
            <option value="">Alle</option>
            {AUDIT_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'var(--theme-muted)' }}>
          Actie
          <select
            value={action}
            onChange={(e) => setAndReset(setAction)(e.target.value)}
            style={{ padding: '7px 10px', fontSize: 13 }}
          >
            <option value="">Alle</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'var(--theme-muted)' }}>
          Vanaf
          <input
            type="date"
            value={from}
            onChange={(e) => setAndReset(setFrom)(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 13 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'var(--theme-muted)' }}>
          Tot
          <input
            type="date"
            value={to}
            onChange={(e) => setAndReset(setTo)(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 13 }}
          />
        </label>
        {hasActiveFilter && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
            Wis filters
          </button>
        )}
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">
            Kon het audit-log niet laden. Controleer of de backend draait en probeer
            pagina-refresh.
          </p>
        </div>
      ) : query.isLoading ? (
        <SkeletonTableRows rows={10} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={hasActiveFilter ? Search : ScrollText}
          title={hasActiveFilter ? 'Geen log-regels gevonden' : 'Nog geen log-regels'}
          description={
            hasActiveFilter
              ? 'Pas de filters aan of verruim de datum-range.'
              : 'Mutaties vanuit orders, retouren, kanalen en meer verschijnen hier automatisch.'
          }
        />
      ) : (
        <div className="card card-flush">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tijd</th>
                  <th>Actor</th>
                  <th>Actie</th>
                  <th>Entiteit</th>
                  <th>Entiteit-ID</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} onClick={() => setSelected(e)} style={{ cursor: 'pointer' }}>
                    <td
                      style={{ fontSize: 12.5, color: 'var(--theme-muted)', whiteSpace: 'nowrap' }}
                      title={formatDateTime(e.createdAt)}
                    >
                      {formatRelative(e.createdAt)}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{actorLabel(e.actor)}</td>
                    <td>
                      <span className={`badge ${actionBadgeClass(e.action)}`}>{e.action}</span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{e.entityType}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: 'var(--theme-muted)' }}>
                      {e.entityId ? truncate(e.entityId, 14) : '—'}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5, color: 'var(--theme-muted)' }}>
                      {e.ip ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(offset > 0 || hasMore) && (
            <div
              style={{
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <span className="muted" style={{ fontSize: 13 }}>
                Regel {offset + 1}–{offset + items.length}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Vorige
                </button>
                <span className="muted" style={{ fontSize: 13 }}>
                  Pagina {page}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!hasMore}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Volgende
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <AuditDetailDrawer entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
