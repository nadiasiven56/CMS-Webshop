/**
 * /settings/webhooks — outbound webhooks op de ECHTE API (`/api/admin/webhooks`).
 *
 * Vervangt de oude mock-state. Eén webhook = één event + url + scope
 * (order/channel/all), optioneel shop-gebonden en met HMAC-secret. SECURITY:
 * het secret komt nooit terug uit de API — alleen `hasSecret`-boolean; in de
 * edit-drawer kun je een nieuw secret zetten maar nooit het bestaande zien.
 * Edit-drawer (url/event/scope/secret/active), create-drawer en delete.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Webhook as WebhookIcon, MoreHorizontal, Edit3, Trash2, RefreshCcw, Lock } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import {
  useWebhookList,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  WEBHOOK_SCOPES,
  type WebhookDto,
  type WebhookScope,
  type WebhookListFilters,
} from '@/components/settings/api';
import { asApiError } from '@/lib/api';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/settings/webhooks')({
  component: WebhooksPage,
});

const PAGE_SIZE = 100;

const COMMON_EVENTS = [
  'order.created', 'order.shipped', 'order.delivered', 'order.cancelled',
  'product.updated', 'stock.low', 'return.requested', 'invoice.created',
  'channel.synced',
];

const SCOPE_LABELS: Record<string, { label: string; klass: string }> = {
  order: { label: 'Order', klass: 'badge-info' },
  channel: { label: 'Channel', klass: 'badge-warning' },
  all: { label: 'Alles', klass: 'badge-accent' },
};

const LIST_FILTERS: WebhookListFilters = { limit: PAGE_SIZE, offset: 0 };

function WebhooksPage() {
  const [edit, setEdit] = useState<WebhookDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WebhookDto | null>(null);

  const query = useWebhookList(LIST_FILTERS);
  const toggleUpdate = useUpdateWebhook(actionMenu ?? '__none__');
  const remove = useDeleteWebhook();

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  useEffect(() => {
    if (!actionMenu) return;
    function onClick() { setActionMenu(null); }
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [actionMenu]);

  function toggleActive(w: WebhookDto) {
    toggleUpdate.mutate(
      { active: !w.active },
      {
        onSuccess: () => toast.success(`Webhook ${w.active ? 'gedeactiveerd' : 'geactiveerd'}`),
        onError: (err) => toast.error(asApiError(err).message),
      },
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Webhooks</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">Outbound HTTP-webhooks naar externe systemen.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={15} strokeWidth={2.2} />
          Webhook toevoegen
        </button>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">Kon webhooks niet laden. Controleer of de backend draait en probeer pagina-refresh.</p>
        </div>
      ) : query.isLoading ? (
        <SkeletonTableRows rows={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title="Nog geen webhooks"
          description="Voeg een endpoint toe om events (orders, voorraad, channels) naar externe systemen te sturen."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> Webhook toevoegen
            </button>
          }
        />
      ) : (
        <div className="table-wrap">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Event</th>
                  <th>Scope</th>
                  <th>Secret</th>
                  <th>Laatst afgevuurd</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Acties</th>
                </tr>
              </thead>
              <tbody>
                {items.map((w) => {
                  const scope = SCOPE_LABELS[w.scope] ?? { label: w.scope, klass: 'badge-neutral' };
                  return (
                    <tr key={w.id} onClick={() => setEdit(w)} style={{ cursor: 'pointer', opacity: w.active ? 1 : 0.6 }}>
                      <td style={{ maxWidth: 320 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <WebhookIcon size={14} style={{ color: 'var(--theme-accent)', flexShrink: 0 }} />
                          <div className="mono" style={{
                            fontSize: 11.5, fontWeight: 500, minWidth: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{w.url}</div>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>{w.event}</span>
                      </td>
                      <td><span className={`badge ${scope.klass}`}>{scope.label}</span></td>
                      <td>
                        {w.hasSecret ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--theme-muted)' }}>
                            <Lock size={11} /> Ja
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--theme-muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>
                        {w.lastFiredAt ? formatRelative(w.lastFiredAt) : <span className="muted">—</span>}
                      </td>
                      <td>
                        {w.active
                          ? <span className="badge badge-success">Actief</span>
                          : <span className="badge badge-neutral">Inactief</span>}
                      </td>
                      <td style={{ textAlign: 'right', position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionMenu(actionMenu === w.id ? null : w.id);
                          }}
                          aria-label="Acties"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {actionMenu === w.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute', top: '100%', right: 8, zIndex: 20,
                              background: 'var(--theme-card)', border: '1px solid var(--border-strong)',
                              borderRadius: 10, boxShadow: 'var(--shadow-lg)',
                              minWidth: 180, padding: 4,
                              display: 'flex', flexDirection: 'column',
                              textAlign: 'left',
                            }}
                          >
                            <ActionMenuItem icon={<Edit3 size={13} />} label="Bewerken" onClick={() => { setActionMenu(null); setEdit(w); }} />
                            <ActionMenuItem
                              icon={<RefreshCcw size={13} />}
                              label={w.active ? 'Deactiveren' : 'Activeren'}
                              onClick={() => { setActionMenu(null); toggleActive(w); }}
                            />
                            <ActionMenuItem
                              icon={<Trash2 size={13} />}
                              label="Verwijderen"
                              danger
                              onClick={() => { setActionMenu(null); setConfirmDelete(w); }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <WebhookEditDrawer webhook={edit} onClose={() => setEdit(null)} />
      <WebhookCreateDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            const w = confirmDelete;
            remove.mutate(w.id, {
              onSuccess: () => toast.success('Webhook verwijderd'),
              onError: (err) => toast.error(asApiError(err).message),
            });
          }
        }}
        title="Webhook verwijderen?"
        message="De endpoint krijgt geen events meer."
        confirmLabel="Ja, verwijder"
      />
    </div>
  );
}

function ActionMenuItem({
  icon, label, onClick, danger,
}: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', background: 'transparent', border: 'none', borderRadius: 6,
        color: danger ? 'var(--danger)' : 'var(--theme-text)',
        textAlign: 'left', cursor: 'pointer', fontSize: 13,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {icon} {label}
    </button>
  );
}

/** Gedeeld formulier-veld-blok voor create + edit (event/url/scope/secret/active). */
interface WebhookFormState {
  event: string;
  url: string;
  scope: WebhookScope;
  secret: string;
  active: boolean;
}

function WebhookFields({
  state, setState, hasExistingSecret,
}: {
  state: WebhookFormState;
  setState: (patch: Partial<WebhookFormState>) => void;
  hasExistingSecret?: boolean;
}) {
  return (
    <>
      <FormField label="URL" required>
        <input
          type="url"
          value={state.url}
          onChange={(e) => setState({ url: e.target.value })}
          required
          placeholder="https://example.com/hooks/webshop"
        />
      </FormField>
      <FormField label="Event" required hint="Welke gebeurtenis triggert deze webhook.">
        <input
          type="text"
          value={state.event}
          onChange={(e) => setState({ event: e.target.value })}
          required
          list="webhook-events"
          placeholder="order.created"
        />
        <datalist id="webhook-events">
          {COMMON_EVENTS.map((ev) => (
            <option key={ev} value={ev} />
          ))}
        </datalist>
      </FormField>
      <FormField label="Scope" hint="Bepaalt welke set events deze endpoint mag ontvangen.">
        <select value={state.scope} onChange={(e) => setState({ scope: e.target.value as WebhookScope })}>
          {WEBHOOK_SCOPES.map((s) => (
            <option key={s} value={s}>
              {s === 'order' ? 'Order — alleen order-events' : s === 'channel' ? 'Channel — channel-sync events' : 'Alles — alle events'}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        label="HMAC-secret"
        hint={
          hasExistingSecret
            ? 'Er is een secret ingesteld. Vul een nieuw secret in om te vervangen, of laat leeg om te behouden.'
            : 'Optioneel. Wordt gebruikt om de outbound-payload te ondertekenen (X-Webhook-Signature).'
        }
      >
        <input
          type="text"
          value={state.secret}
          onChange={(e) => setState({ secret: e.target.value })}
          placeholder={hasExistingSecret ? '•••••• (ingesteld)' : 'whsec_…'}
          autoComplete="new-password"
        />
      </FormField>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, marginTop: 8 }}>
        <input
          type="checkbox"
          checked={state.active}
          onChange={(e) => setState({ active: e.target.checked })}
          style={{ width: 16, height: 16, padding: 0 }}
        />
        <span>Actief — events worden direct verzonden</span>
      </label>
    </>
  );
}

function WebhookCreateDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setStateRaw] = useState<WebhookFormState>({
    event: 'order.created', url: 'https://', scope: 'order', secret: '', active: true,
  });
  const setState = (patch: Partial<WebhookFormState>) => setStateRaw((s) => ({ ...s, ...patch }));
  const create = useCreateWebhook();

  useEffect(() => {
    if (open) {
      setStateRaw({ event: 'order.created', url: 'https://', scope: 'order', secret: '', active: true });
    }
  }, [open]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!state.url || !state.url.startsWith('http')) {
      toast.error('Vul een geldige URL in');
      return;
    }
    if (!state.event.trim()) {
      toast.error('Vul een event in');
      return;
    }
    create.mutate(
      {
        event: state.event.trim(),
        url: state.url.trim(),
        scope: state.scope,
        secret: state.secret.trim() || null,
        active: state.active,
      },
      {
        onSuccess: () => {
          toast.success('Webhook toegevoegd');
          onClose();
        },
        onError: (err) => toast.error(asApiError(err).message),
      },
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Webhook toevoegen"
      subtitle="Stuur events naar een externe HTTP-endpoint."
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="wh-create-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Toevoegen…' : 'Toevoegen'}
          </button>
        </>
      }
    >
      <form id="wh-create-form" onSubmit={onSubmit}>
        <WebhookFields state={state} setState={setState} />
      </form>
    </Drawer>
  );
}

function WebhookEditDrawer({ webhook, onClose }: { webhook: WebhookDto | null; onClose: () => void }) {
  const open = webhook != null;
  const [state, setStateRaw] = useState<WebhookFormState>({
    event: '', url: '', scope: 'order', secret: '', active: true,
  });
  const setState = (patch: Partial<WebhookFormState>) => setStateRaw((s) => ({ ...s, ...patch }));
  const update = useUpdateWebhook(webhook?.id ?? '__none__');

  useEffect(() => {
    if (webhook) {
      setStateRaw({
        event: webhook.event,
        url: webhook.url,
        scope: webhook.scope as WebhookScope,
        secret: '',
        active: webhook.active,
      });
    }
  }, [webhook]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!webhook) return;
    if (!state.url || !state.url.startsWith('http')) {
      toast.error('Vul een geldige URL in');
      return;
    }
    if (!state.event.trim()) {
      toast.error('Vul een event in');
      return;
    }
    update.mutate(
      {
        event: state.event.trim(),
        url: state.url.trim(),
        scope: state.scope,
        active: state.active,
        // Alleen meesturen als de gebruiker een nieuw secret intypte.
        ...(state.secret.trim() ? { secret: state.secret.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Webhook bijgewerkt');
          onClose();
        },
        onError: (err) => toast.error(asApiError(err).message),
      },
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Webhook bewerken"
      subtitle={webhook?.url}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="wh-edit-form" className="btn btn-primary" disabled={update.isPending}>
            {update.isPending ? 'Opslaan…' : 'Opslaan'}
          </button>
        </>
      }
    >
      {webhook && (
        <form id="wh-edit-form" onSubmit={onSubmit}>
          <WebhookFields state={state} setState={setState} hasExistingSecret={webhook.hasSecret} />
        </form>
      )}
    </Drawer>
  );
}
