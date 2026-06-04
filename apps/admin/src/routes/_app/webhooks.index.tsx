/**
 * /webhooks (index) — webhook-DELIVERY-monitor op de ECHTE API (`/api/webhooks`).
 *
 * Een aflever-log (event, url, status-code, geslaagd/mislukt, duur, tijd) met
 * filters (event-dropdown uit /events, geslaagd-filter), een row-click
 * detail-drawer (volle payload + response-body + signature-header) en een
 * "Test-fire"-modal (event + url + optioneel secret → afvuren → resultaat).
 *
 * NB: webhook-CRUD blijft op /settings/webhooks; dit is ALLEEN de monitor.
 * Mirror van channels.index.tsx (layout = pure <Outlet/>, deze id eindigt op '/').
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Zap, Webhook as WebhookIcon, CheckCircle2, XCircle, Search } from 'lucide-react';
import {
  useDeliveries,
  useWebhookEvents,
  type WebhookDeliveryListDto,
  type DeliveryListFilters,
} from '@/components/webhooks/api';
import { DeliveryDetailDrawer } from '@/components/webhooks/DeliveryDetailDrawer';
import { TestFireModal } from '@/components/webhooks/TestFireModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { formatRelative, formatDateTime, truncate } from '@/lib/format';

export const Route = createFileRoute('/_app/webhooks/')({
  component: WebhookDeliveriesPage,
});

const PAGE_SIZE = 50;

type SuccessFilter = 'all' | 'success' | 'fail';

const SUCCESS_TABS: Array<{ value: SuccessFilter; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'success', label: 'Geslaagd' },
  { value: 'fail', label: 'Mislukt' },
];

function WebhookDeliveriesPage() {
  const eventsQuery = useWebhookEvents();
  const events = eventsQuery.data ?? [];

  const [eventFilter, setEventFilter] = useState('');
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>('all');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<WebhookDeliveryListDto | null>(null);
  const [testOpen, setTestOpen] = useState(false);

  const filters: DeliveryListFilters = {
    event: eventFilter || undefined,
    success:
      successFilter === 'all' ? undefined : successFilter === 'success' ? true : false,
    limit: PAGE_SIZE,
    offset,
  };

  const query = useDeliveries(filters);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetAndSet<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setOffset(0);
    };
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Webhook-log</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">
            Aflever-historie van uitgaande webhooks — status, duur en payload per poging.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setTestOpen(true)}>
          <Zap size={15} strokeWidth={2.2} />
          Test-fire
        </button>
      </div>

      {/* Filters */}
      <div className="toolbar" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <select
          value={eventFilter}
          onChange={(e) => resetAndSet(setEventFilter)(e.target.value)}
          style={{ padding: '7px 10px', fontSize: 13 }}
          aria-label="Filter op event"
        >
          <option value="">Alle events</option>
          {events.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
        <div className="segmented" role="tablist" aria-label="Status-filter">
          {SUCCESS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              data-active={successFilter === t.value}
              onClick={() => resetAndSet(setSuccessFilter)(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">
            Kon het webhook-log niet laden. Controleer of de backend draait en probeer
            pagina-refresh.
          </p>
        </div>
      ) : query.isLoading ? (
        <SkeletonTableRows rows={8} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={eventFilter || successFilter !== 'all' ? Search : WebhookIcon}
          title={
            eventFilter || successFilter !== 'all'
              ? 'Geen afleveringen gevonden'
              : 'Nog geen afleveringen'
          }
          description={
            eventFilter || successFilter !== 'all'
              ? 'Pas de filters aan of doe een test-fire.'
              : 'Zodra een domein-event een webhook triggert verschijnt hier een regel. Doe een test-fire om te beginnen.'
          }
          action={
            <button type="button" className="btn btn-primary" onClick={() => setTestOpen(true)}>
              <Zap size={14} /> Test-fire
            </button>
          }
        />
      ) : (
        <div className="card card-flush">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Resultaat</th>
                  <th style={{ textAlign: 'right' }}>Duur</th>
                  <th>Tijd</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} onClick={() => setSelected(d)} style={{ cursor: 'pointer' }}>
                    <td className="mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {d.event}
                    </td>
                    <td
                      style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}
                      title={d.url}
                    >
                      {truncate(d.url, 44)}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {d.responseStatus != null ? (
                        <span className="mono" style={{ fontSize: 12 }}>
                          {d.responseStatus}
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>
                          —
                        </span>
                      )}
                    </td>
                    <td>
                      {d.success ? (
                        <span
                          className="badge badge-success"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <CheckCircle2 size={11} /> Geslaagd
                        </span>
                      ) : (
                        <span
                          className="badge badge-danger"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <XCircle size={11} /> Mislukt
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 12.5,
                        color: 'var(--theme-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {d.durationMs != null ? `${d.durationMs} ms` : '—'}
                    </td>
                    <td
                      style={{ fontSize: 12.5, color: 'var(--theme-muted)', whiteSpace: 'nowrap' }}
                      title={formatDateTime(d.createdAt)}
                    >
                      {formatRelative(d.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE_SIZE && (
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
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} van {total}
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
        </div>
      )}

      <DeliveryDetailDrawer delivery={selected} onClose={() => setSelected(null)} />
      <TestFireModal open={testOpen} onClose={() => setTestOpen(false)} />
    </div>
  );
}
