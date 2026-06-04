/**
 * /notifications (index) — transactionele e-mail op de ECHTE API
 * (`/api/notifications/*`). Drie secties:
 *   (a) Providers — grid met status-pill + actief-badge, "Configureren"-drawer
 *       (creds + afzender-config + Test + Activeren zodat exact één actief is),
 *       plus onboarding-help.
 *   (b) Templates — lijst van de geseede templates met editor-drawer
 *       (subject + bodyHtml + bodyText + enabled-toggle) en "Test-mail sturen".
 *   (c) E-mail-log — compacte tabel (ontvanger, onderwerp, status, tijd).
 *
 * Mirror van channels.index.tsx (kaarten + drawer + modal + EmptyState + skeleton
 * + toast). Dit is de INDEX-route van het notifications-layout (notifications.tsx
 * rendert enkel <Outlet/>).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Plus, Settings as SettingsIcon, Mail, FileText, ScrollText, Star,
  CheckCircle2, CircleDashed, ServerCrash, AlertTriangle,
} from 'lucide-react';
import { ProviderStatusPill, EmailLogStatusPill } from '@/components/notifications/ProviderStatusPill';
import { ProviderConfigDrawer } from '@/components/notifications/ProviderConfigDrawer';
import { TemplateEditorDrawer } from '@/components/notifications/TemplateEditorDrawer';
import {
  useProviders,
  useCreateProvider,
  useTemplates,
  useEmailLog,
  providerMeta,
  templateMeta,
  PROVIDER_META,
  type ProviderDto,
  type TemplateDto,
  type EmailProviderType,
} from '@/components/notifications/api';
import { formatRelative, formatDateTime, truncate } from '@/lib/format';
import { asApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/notifications/')({
  component: NotificationsPage,
});

function NotificationsPage() {
  const providersQuery = useProviders();
  const templatesQuery = useTemplates();
  const logQuery = useEmailLog({ limit: 20 });

  const [config, setConfig] = useState<ProviderDto | null>(null);
  const [editTemplate, setEditTemplate] = useState<TemplateDto | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const providers = providersQuery.data?.items ?? [];
  const templates = templatesQuery.data?.items ?? [];
  const logs = logQuery.data?.items ?? [];

  const activeProvider = providers.find((p) => p.isActive && p.status === 'connected') ?? null;
  const hasActiveProvider = activeProvider != null;

  // Houd de geopende drawers in sync met verse data na invalidatie.
  useEffect(() => {
    if (!config) return;
    const fresh = providers.find((p) => p.id === config.id);
    if (fresh && fresh !== config) setConfig(fresh);
  }, [providers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editTemplate) return;
    const fresh = templates.find((t) => t.key === editTemplate.key);
    if (fresh && fresh !== editTemplate) setEditTemplate(fresh);
  }, [templates]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">E-mail</h1>
            <span className="count-badge">{providers.length}</span>
          </div>
          <p className="page-subtitle">
            Transactionele e-mail — providers, templates en bezorg-log.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
            <Plus size={15} strokeWidth={2.2} />
            Provider toevoegen
          </button>
        </div>
      </div>

      {/* Onboarding-banner als er nog geen actieve provider is */}
      {!providersQuery.isLoading && !hasActiveProvider && (
        <div
          className="card"
          style={{
            marginBottom: 20,
            background: 'var(--theme-accent-subtle)',
            borderColor: 'var(--theme-accent-border)',
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Mail size={18} style={{ color: 'var(--theme-accent)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 12.5, color: 'var(--text-soft)', lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--theme-text)' }}>Nog geen actieve e-mail-provider.</strong>{' '}
              Voeg een provider toe (SMTP, Postmark, SendGrid of Mailgun), vul de credentials in,
              test de verbinding en activeer hem. Tot die tijd worden transactionele mails
              overgeslagen (<code>skipped_no_provider</code>) — orders en retouren blijven gewoon werken.
            </div>
          </div>
        </div>
      )}

      {/* ─── (a) Providers ─────────────────────────────────── */}
      <SectionHeader icon={Mail} title="Providers" subtitle="Verbind een e-mail-dienst. Exact één is actief." />

      {providersQuery.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">
            Kon providers niet laden. Controleer of de backend draait en probeer pagina-refresh.
          </p>
        </div>
      ) : providersQuery.isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} height={200} />
          ))}
        </div>
      ) : providers.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="Nog geen providers"
          description="Voeg een e-mail-provider toe om transactionele mail te kunnen versturen."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> Provider toevoegen
            </button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} onConfigure={() => setConfig(p)} />
          ))}
          <button
            type="button"
            className="card"
            onClick={() => setAddOpen(true)}
            style={{
              border: '1px dashed var(--border-default)',
              background: 'transparent',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              minHeight: 200, cursor: 'pointer', color: 'var(--theme-muted)',
              padding: 24,
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 13,
              background: 'var(--surface-3)', border: '1px solid var(--border-default)',
              display: 'grid', placeItems: 'center', marginBottom: 12,
              color: 'var(--theme-accent)',
            }}>
              <Plus size={20} strokeWidth={2.4} />
            </div>
            <div style={{ fontWeight: 600, color: 'var(--theme-text)', marginBottom: 4 }}>
              Voeg provider toe
            </div>
            <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 220 }}>
              SMTP, Postmark, SendGrid of Mailgun.
            </div>
          </button>
        </div>
      )}

      {/* ─── (b) Templates ─────────────────────────────────── */}
      <div style={{ marginTop: 32 }}>
        <SectionHeader icon={FileText} title="Templates" subtitle="Bewerk de transactionele e-mailteksten." />

        {templatesQuery.isError ? (
          <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
            <p className="error-text">Kon templates niet laden.</p>
          </div>
        ) : templatesQuery.isLoading ? (
          <SkeletonCard height={220} />
        ) : templates.length === 0 ? (
          <EmptyState icon={FileText} title="Geen templates" description="Er zijn nog geen e-mailtemplates geseed." />
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {templates.map((t, i) => {
              const meta = templateMeta(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setEditTemplate(t)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 16px',
                    background: 'transparent',
                    border: 'none',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: 9,
                      background: 'var(--theme-accent-subtle)',
                      border: '1px solid var(--theme-accent-border)',
                      color: 'var(--theme-accent)',
                      display: 'grid', placeItems: 'center', flexShrink: 0,
                    }}
                  >
                    <FileText size={15} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, color: 'var(--theme-text)', fontSize: 13.5 }}>
                        {meta.label}
                      </span>
                      <span
                        className={`badge ${t.enabled ? 'badge-success' : 'badge-neutral'}`}
                        style={{ fontSize: 10.5 }}
                      >
                        {t.enabled ? 'Aan' : 'Uit'}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12, color: 'var(--theme-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        marginTop: 2,
                      }}
                    >
                      {t.subject}
                    </div>
                  </div>
                  <SettingsIcon size={15} style={{ color: 'var(--theme-muted)', flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── (c) E-mail-log ────────────────────────────────── */}
      <div style={{ marginTop: 32 }}>
        <SectionHeader icon={ScrollText} title="Bezorg-log" subtitle="De laatste verstuurde (of overgeslagen) mails." />

        {logQuery.isError ? (
          <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
            <p className="error-text">Kon de e-mail-log niet laden.</p>
          </div>
        ) : logQuery.isLoading ? (
          <SkeletonCard height={180} />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="Nog geen e-mails"
            description="Zodra er mail verstuurd wordt (of een test-mail), verschijnt die hier."
          />
        ) : (
          <div className="table-wrap">
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Ontvanger</th>
                    <th>Onderwerp</th>
                    <th>Template</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th style={{ textAlign: 'right' }}>Wanneer</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td style={{ fontSize: 12.5 }}>{l.toEmail}</td>
                      <td style={{ fontSize: 12.5 }}>{truncate(l.subject, 48)}</td>
                      <td style={{ fontSize: 12, color: 'var(--theme-muted)' }}>
                        {l.templateKey ? templateMeta(l.templateKey).label : <span className="muted">—</span>}
                      </td>
                      <td><EmailLogStatusPill status={l.status} /></td>
                      <td style={{ fontSize: 12, color: 'var(--theme-muted)' }}>
                        {l.provider ?? <span className="muted">—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--theme-muted)' }} title={formatDateTime(l.createdAt)}>
                        {formatRelative(l.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <ProviderConfigDrawer provider={config} onClose={() => setConfig(null)} />
      <TemplateEditorDrawer
        template={editTemplate}
        hasActiveProvider={hasActiveProvider}
        onClose={() => setEditTemplate(null)}
      />
      <AddProviderModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Mail;
  title: string;
  subtitle: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <div
        style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'var(--surface-3)', border: '1px solid var(--border-default)',
          color: 'var(--theme-accent)', display: 'grid', placeItems: 'center', flexShrink: 0,
        }}
      >
        <Icon size={15} />
      </div>
      <div>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--theme-text)' }}>{title}</h2>
        <div style={{ fontSize: 12, color: 'var(--theme-muted)' }}>{subtitle}</div>
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  onConfigure,
}: {
  provider: ProviderDto;
  onConfigure: () => void;
}) {
  const meta = providerMeta(provider.provider);
  const hasUsableCredentials =
    provider.hasCredentials && Object.keys(provider.credentials ?? {}).length > 0;

  return (
    <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(circle at top right, ${meta.accent}10, transparent 60%)`,
          pointerEvents: 'none',
        }}
      />
      <div className="card-header" style={{ alignItems: 'flex-start', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44, height: 44, borderRadius: 11,
              background: meta.accent,
              display: 'grid', placeItems: 'center',
              color: '#fff', fontWeight: 800, fontSize: 19,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              flexShrink: 0,
            }}
          >
            {meta.letter}
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 className="card-title" style={{ marginBottom: 3 }}>{provider.name}</h2>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>{meta.label}</span>
              <ProviderStatusPill status={provider.status} />
              {provider.isActive && (
                <span
                  className="badge badge-success"
                  style={{ fontSize: 10.5, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                >
                  <Star size={10} /> Actief
                </span>
              )}
            </div>
          </div>
        </div>
        <StatusIcon status={provider.status} />
      </div>

      <div style={{
        fontSize: 12, lineHeight: 1.45, padding: '10px 12px',
        background: 'var(--surface-2)', borderRadius: 8,
        border: '1px solid var(--border-subtle)', color: 'var(--text-soft)',
        marginBottom: 12, position: 'relative',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
        }}>
          <span style={{ fontSize: 10.5, color: 'var(--theme-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Credentials
          </span>
          <span style={{ fontSize: 11, color: hasUsableCredentials ? 'var(--success)' : 'var(--theme-muted)' }}>
            {hasUsableCredentials ? 'Gezet' : 'Niet gezet'}
          </span>
        </div>
        {!hasUsableCredentials
          ? meta.hint
          : provider.status === 'connected'
            ? provider.isActive
              ? 'Verbonden en actief — verstuurt transactionele mail.'
              : 'Verbonden — klik op Configureren om te activeren.'
            : provider.status === 'error'
              ? 'Laatste verbindingstest mislukt — controleer credentials.'
              : 'Credentials gezet — test de verbinding om te verbinden.'}
        {provider.lastTestAt && (
          <div style={{ fontSize: 10.5, color: 'var(--theme-muted)', marginTop: 4 }}>
            Laatst getest {formatRelative(provider.lastTestAt)}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={onConfigure}
        >
          <SettingsIcon size={13} /> Configureren
        </button>
      </div>
    </div>
  );
}

function AddProviderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const TYPE_META: Record<EmailProviderType, { label: string; accent: string; letter: string }> = {
    smtp: { label: PROVIDER_META.smtp!.label, accent: PROVIDER_META.smtp!.accent, letter: PROVIDER_META.smtp!.letter },
    postmark: { label: PROVIDER_META.postmark!.label, accent: PROVIDER_META.postmark!.accent, letter: PROVIDER_META.postmark!.letter },
    sendgrid: { label: PROVIDER_META.sendgrid!.label, accent: PROVIDER_META.sendgrid!.accent, letter: PROVIDER_META.sendgrid!.letter },
    mailgun: { label: PROVIDER_META.mailgun!.label, accent: PROVIDER_META.mailgun!.accent, letter: PROVIDER_META.mailgun!.letter },
  };

  const [providerType, setProviderType] = useState<EmailProviderType>('smtp');
  const [name, setName] = useState(PROVIDER_META.smtp!.label);
  const create = useCreateProvider();

  useEffect(() => {
    if (open) {
      setProviderType('smtp');
      setName(PROVIDER_META.smtp!.label);
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const finalName = name.trim() || TYPE_META[providerType].label;
    try {
      await create.mutateAsync({ provider: providerType, name: finalName });
      toast.success(`Provider ${finalName} toegevoegd — niet-verbonden. Configureer & activeer.`);
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Aanmaken mislukt: ${e2.message}`);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="E-mail-provider toevoegen"
      subtitle="Selecteer een provider-type en geef een naam op."
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="add-provider-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Aanmaken…' : 'Provider aanmaken'}
          </button>
        </>
      }
    >
      <form id="add-provider-form" onSubmit={onSubmit}>
        <FormField label="Type">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {(Object.entries(TYPE_META) as Array<[EmailProviderType, typeof TYPE_META[EmailProviderType]]>).map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => { setProviderType(k); setName(v.label); }}
                style={{
                  padding: '12px 10px',
                  background: providerType === k ? 'var(--theme-accent-subtle)' : 'var(--surface-2)',
                  border: providerType === k ? '1px solid var(--theme-accent-border)' : '1px solid var(--border-default)',
                  borderRadius: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: v.accent, color: '#fff',
                  display: 'grid', placeItems: 'center',
                  fontWeight: 700, fontSize: 12,
                }}>{v.letter}</div>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{v.label}</span>
              </button>
            ))}
          </div>
        </FormField>
        <FormField label="Naam" required>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder={TYPE_META[providerType].label} />
        </FormField>
        <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-soft)', lineHeight: 1.5 }}>
          De provider wordt aangemaakt als <strong>niet-verbonden</strong>. Klik daarna op "Configureren" om credentials in te voeren, te testen en te activeren.
        </div>
      </form>
    </Modal>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'connected') return <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />;
  if (status === 'error') return <ServerCrash size={18} style={{ color: 'var(--danger)' }} />;
  if (status === 'disconnected') return <CircleDashed size={18} style={{ color: 'var(--theme-muted)' }} />;
  return <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />;
}
