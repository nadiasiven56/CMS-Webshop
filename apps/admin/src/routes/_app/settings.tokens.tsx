/**
 * /settings/tokens — API-tokens op de ECHTE API (`/api/admin/api-tokens`).
 *
 * Vervangt de oude mock-state. SECURITY: de raw token wordt door de backend
 * exact 1× teruggegeven in de create-response (`token`) en daarna nergens meer
 * geserveerd — we tonen hem direct in een lock-modal zodat de gebruiker kan
 * kopiëren. De lijst toont alleen metadata (label / scope / laatst gebruikt /
 * aangemaakt). Revoke = verwijderen (POST /:id/revoke).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Plus, KeyRound, Trash2, Copy } from 'lucide-react';
import { formatRelative, formatDate } from '@/lib/format';
import {
  useTokenList,
  useCreateToken,
  useRevokeToken,
  type ApiTokenDto,
  type ApiTokenListFilters,
} from '@/components/settings/api';
import { asApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/settings/tokens')({
  component: TokensPage,
});

const PAGE_SIZE = 100;

const SCOPE_LABELS: Record<string, { label: string; klass: string }> = {
  storefront: { label: 'Storefront', klass: 'badge-info' },
  channel: { label: 'Channel', klass: 'badge-warning' },
  admin: { label: 'Admin', klass: 'badge-accent' },
  webhook: { label: 'Webhook', klass: 'badge-neutral' },
};

const LIST_FILTERS: ApiTokenListFilters = { limit: PAGE_SIZE, offset: 0 };

function TokensPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [showToken, setShowToken] = useState<{ token: string; label: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiTokenDto | null>(null);

  const query = useTokenList(LIST_FILTERS);
  const revoke = useRevokeToken();

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">API-tokens</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">Tokens voor storefront-API, channel-koppelingen en admin-readonly toegang.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={15} strokeWidth={2.2} />
          Nieuwe token
        </button>
      </div>

      <div
        style={{
          padding: '12px 16px', marginBottom: 16,
          background: 'var(--theme-accent-subtle)',
          border: '1px solid var(--theme-accent-border)',
          borderRadius: 10,
          fontSize: 12.5, color: 'var(--theme-text)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}
      >
        <KeyRound size={16} style={{ color: 'var(--theme-accent)', marginTop: 2 }} />
        <div>
          <strong>Tokens worden maar één keer getoond.</strong>{' '}
          Direct na aanmaken kopiëren — daarna wordt alleen metadata bewaard. Gebruik scopes om de bevoegdheid te beperken.
        </div>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">Kon tokens niet laden. Controleer of de backend draait en probeer pagina-refresh.</p>
        </div>
      ) : query.isLoading ? (
        <SkeletonTableRows rows={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="Nog geen API-tokens"
          description="Genereer een token om externe systemen (storefront, channels, webhooks) toegang te geven tot de API."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> Nieuwe token
            </button>
          }
        />
      ) : (
        <div className="table-wrap">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Scope</th>
                  <th>Laatst gebruikt</th>
                  <th>Aangemaakt</th>
                  <th style={{ textAlign: 'right' }}>Acties</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => {
                  const scope = SCOPE_LABELS[t.scope] ?? { label: t.scope, klass: 'badge-neutral' };
                  return (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 500 }}>{t.label}</td>
                      <td><span className={`badge ${scope.klass}`}>{scope.label}</span></td>
                      <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>
                        {t.lastUsedAt ? formatRelative(t.lastUsedAt) : <span className="muted">nooit</span>}
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>{formatDate(t.createdAt)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          title="Intrekken"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => setConfirmRevoke(t)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateTokenModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(label, fullToken) => {
          setCreateOpen(false);
          setShowToken({ token: fullToken, label });
        }}
      />
      <ShowTokenModal
        data={showToken}
        onClose={() => setShowToken(null)}
      />
      <ConfirmDialog
        open={confirmRevoke !== null}
        onClose={() => setConfirmRevoke(null)}
        onConfirm={() => {
          if (confirmRevoke) {
            const t = confirmRevoke;
            revoke.mutate(t.id, {
              onSuccess: () => toast.success(`Token ${t.label} ingetrokken`),
              onError: (err) => toast.error(asApiError(err).message),
            });
          }
        }}
        title="Token intrekken?"
        message={
          <>
            Token <strong>{confirmRevoke?.label}</strong> wordt direct ongeldig. Externe systemen die hem
            gebruiken, krijgen 401's. Dit is niet ongedaan te maken.
          </>
        }
        confirmLabel="Ja, trek in"
      />
    </div>
  );
}

function CreateTokenModal({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (label: string, fullToken: string) => void }) {
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<'storefront' | 'channel' | 'admin' | 'webhook'>('storefront');
  const create = useCreateToken();

  useEffect(() => {
    if (open) {
      setLabel('');
      setScope('storefront');
    }
  }, [open]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      toast.error('Geef de token een herkenbare naam');
      return;
    }
    create.mutate(
      { label: label.trim(), scope },
      {
        onSuccess: (res) => {
          onCreated(res.apiToken.label, res.token);
        },
        onError: (err) => toast.error(asApiError(err).message),
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nieuwe API-token"
      subtitle="Token wordt na aanmaken 1× getoond."
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="token-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Genereren…' : 'Genereer token'}
          </button>
        </>
      }
    >
      <form id="token-form" onSubmit={onSubmit}>
        <FormField label="Label" required hint="Bv 'Storefront crema-prod' of 'Bol-channel-staging'.">
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} required />
        </FormField>
        <FormField label="Scope">
          <select value={scope} onChange={(e) => setScope(e.target.value as 'storefront' | 'channel' | 'admin' | 'webhook')}>
            <option value="storefront">Storefront — read-only catalog + order-create</option>
            <option value="channel">Channel — sync products to marketplace</option>
            <option value="admin">Admin — full read/write</option>
            <option value="webhook">Webhook — verify outbound HMAC</option>
          </select>
        </FormField>
      </form>
    </Modal>
  );
}

function ShowTokenModal({ data, onClose }: { data: { token: string; label: string } | null; onClose: () => void }) {
  return (
    <Modal
      open={data !== null}
      onClose={onClose}
      lockBackdrop
      title="Token klaar — kopieer nu!"
      subtitle="Sluit je dit venster, dan zie je de full-token nooit meer."
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Begrepen
        </button>
      }
    >
      {data && (
        <>
          <div style={{ fontSize: 12, color: 'var(--theme-muted)', marginBottom: 6 }}>
            <strong style={{ color: 'var(--theme-text)' }}>{data.label}</strong>
          </div>
          <div
            style={{
              padding: '12px 14px',
              background: 'var(--surface-1)',
              border: '1px solid var(--theme-accent-border)',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <code className="mono" style={{ flex: 1, fontSize: 11.5, wordBreak: 'break-all', color: 'var(--theme-accent)' }}>
              {data.token}
            </code>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                navigator.clipboard?.writeText(data.token).catch(() => {});
                toast.success('Token gekopieerd');
              }}
            >
              <Copy size={13} /> Kopieer
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
