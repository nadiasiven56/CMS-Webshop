/**
 * SourceConfigDrawer — configureer credentials/config van één review-provider op
 * de ECHTE API, met EXACT de officiële credential- en config-velden per provider.
 *
 * Spiegelt channels/ChannelConfigDrawer.tsx:
 *   - per-provider credential-velden (uit PROVIDER_CREDENTIAL_FIELDS) → PUT /:id/credentials
 *   - per-provider config-velden (locationId/businessUnitId/accountId) → PATCH /:id {config}
 *   - "Test verbinding" → POST /:id/test-connection → status-pill + result-banner
 *   - "Reviews ophalen" → POST /:id/fetch → upsert + samenvatting (toast)
 *   - masked presence-map (`source.credentials`) toont WELKE velden al gezet zijn
 *     als placeholder; leeg laten = behoud bestaande creds.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, DownloadCloud, XCircle } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import {
  useSetSourceCredentials,
  useUpdateSource,
  useTestSource,
  useFetchReviews,
  providerMeta,
  PROVIDER_CREDENTIAL_FIELDS,
  PROVIDER_CONFIG_FIELDS,
  PROVIDER_ONBOARDING,
  type ReviewSourceDto,
  type ReviewProvider,
} from './api';

const KNOWN_PROVIDERS: ReviewProvider[] = ['kiyoh', 'trustpilot', 'google'];

function isKnownProvider(p: string): p is ReviewProvider {
  return (KNOWN_PROVIDERS as string[]).includes(p);
}

export function SourceConfigDrawer({
  source,
  onClose,
}: {
  source: ReviewSourceDto | null;
  onClose: () => void;
}) {
  const open = source != null;
  const sourceId = source?.id ?? '';

  const setCredentials = useSetSourceCredentials(sourceId);
  const updateSource = useUpdateSource(sourceId);
  const testSource = useTestSource(sourceId);
  const fetchReviews = useFetchReviews(sourceId);

  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);

  useEffect(() => {
    if (!open || !source) return;
    setCredValues({});
    setStepsOpen(false);
    setTestResult(null);
    // Config-velden voorvullen vanuit source.config.
    const cfg = source.config ?? {};
    const provider = source.provider;
    const fields = isKnownProvider(provider) ? PROVIDER_CONFIG_FIELDS[provider] : [];
    const next: Record<string, string> = {};
    for (const f of fields) {
      const v = cfg[f.key];
      next[f.key] = typeof v === 'string' ? v : v != null ? String(v) : '';
    }
    setConfigValues(next);
  }, [open, source]);

  if (!source) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const provider = source.provider;
  const meta = providerMeta(provider);
  const credFields = isKnownProvider(provider) ? PROVIDER_CREDENTIAL_FIELDS[provider] : [];
  const configFields = isKnownProvider(provider) ? PROVIDER_CONFIG_FIELDS[provider] : [];
  const onboarding = isKnownProvider(provider) ? PROVIDER_ONBOARDING[provider] : undefined;

  const has = (field: string) => source.credentials[field] === 'set';
  const credPlaceholder = (f: { key: string; placeholder?: string }) =>
    has(f.key) ? '•••••••• (ingevuld — laat leeg om te behouden)' : (f.placeholder ?? '');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!source) return;
    try {
      // 1) config wegschrijven (alleen niet-lege velden; lege wissen).
      const config: Record<string, unknown> = { ...source.config };
      for (const f of configFields) {
        const v = (configValues[f.key] ?? '').trim();
        if (v) config[f.key] = v;
        else delete config[f.key];
      }
      await updateSource.mutateAsync({ config });

      // 2) credentials (alleen ingevulde velden).
      const creds: Record<string, string> = {};
      for (const f of credFields) {
        const v = (credValues[f.key] ?? '').trim();
        if (v) creds[f.key] = v;
      }

      if (Object.keys(creds).length === 0) {
        toast.success(
          `Instellingen ${source.name} opgeslagen — vul credentials in om te activeren.`,
        );
        onClose();
        return;
      }

      await setCredentials.mutateAsync(creds);
      toast.success(`Credentials ${source.name} opgeslagen (versleuteld) — test de verbinding.`);
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Opslaan mislukt: ${e2.message}`);
    }
  }

  async function onTest() {
    if (!source) return;
    setTestResult(null);
    try {
      const res = await testSource.mutateAsync();
      setTestResult({ ok: res.ok, detail: res.detail });
      if (res.ok) toast.success(`${source.name}: verbinding ok — ${res.detail}`);
      else toast.error(`${source.name}: ${res.detail}`);
    } catch (err) {
      const e2 = asApiError(err);
      setTestResult({ ok: false, detail: e2.message });
      toast.error(`Test mislukt: ${e2.message}`);
    }
  }

  async function onFetch() {
    if (!source) return;
    try {
      const res = await fetchReviews.mutateAsync();
      const errPart = res.errors.length > 0 ? ` (${res.errors.length} fout(en))` : '';
      toast.success(
        `${source.name}: ${res.upserted} review(s) opgehaald — gemiddeld ${res.ratingAverage ?? '—'} (${res.ratingCount})${errPart}`,
      );
    } catch (err) {
      const e2 = asApiError(err);
      if (e2.code === 'review_source_not_connected') {
        toast.error(`${source.name} is niet verbonden — koppel credentials eerst.`);
      } else {
        toast.error(`Ophalen mislukt: ${e2.message}`);
      }
    }
  }

  const saving = setCredentials.isPending || updateSource.isPending;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={source.name}
      subtitle={`Configuratie • ${meta.kind}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleer
          </button>
          <button type="submit" form="source-config" className="btn btn-primary" disabled={saving}>
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </>
      }
    >
      <form id="source-config" onSubmit={onSubmit}>
        {/* Connect-status + acties */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '10px 12px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 12.5 }}>
            <div style={{ color: 'var(--theme-muted)', fontSize: 11 }}>Status</div>
            <div style={{ fontWeight: 600 }}>
              {source.status === 'connected'
                ? 'Verbonden'
                : source.status === 'error'
                  ? 'Fout'
                  : 'Niet verbonden'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void onTest()}
              disabled={testSource.isPending}
            >
              {testSource.isPending ? 'Testen…' : 'Test verbinding'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void onFetch()}
              disabled={fetchReviews.isPending}
            >
              <DownloadCloud size={13} className={fetchReviews.isPending ? 'spin' : ''} />
              {fetchReviews.isPending ? 'Ophalen…' : 'Reviews ophalen'}
            </button>
          </div>
        </div>

        {testResult && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 12.5,
              background: testResult.ok ? 'var(--success-soft)' : 'var(--danger-soft)',
              border: `1px solid ${testResult.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
              color: testResult.ok ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {testResult.ok ? (
              <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            ) : (
              <XCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            )}
            <span>{testResult.detail}</span>
          </div>
        )}

        {(source.status === 'disconnected' || source.status === 'error') && (
          <div
            style={{
              padding: '10px 12px',
              background: 'var(--theme-accent-subtle)',
              border: '1px solid var(--theme-accent-border)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text-soft)',
              lineHeight: 1.5,
              marginBottom: 16,
            }}
          >
            Vul de credentials in, klik op <strong>Opslaan</strong> en daarna op{' '}
            <strong>Test verbinding</strong> om deze provider te activeren.
          </div>
        )}

        {/* Officiële stappen (collapsible) */}
        {onboarding && (
          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              marginBottom: 16,
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => setStepsOpen((v) => !v)}
              aria-expanded={stepsOpen}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 12px',
                background: 'var(--surface-2)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--theme-text)',
                textAlign: 'left',
              }}
            >
              {stepsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Officiële stappen — {onboarding.title}
            </button>
            {stepsOpen && (
              <ol
                style={{
                  margin: 0,
                  padding: '10px 14px 12px 28px',
                  fontSize: 12,
                  lineHeight: 1.55,
                  color: 'var(--text-soft)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                {onboarding.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* Credential-velden */}
        {credFields.map((f) => (
          <FormField key={f.key} label={f.label} required={f.required} hint={f.hint}>
            <input
              type={f.type}
              value={credValues[f.key] ?? ''}
              onChange={(e) => setCredValues((p) => ({ ...p, [f.key]: e.target.value }))}
              placeholder={credPlaceholder(f) || (f.type === 'password' ? '••••••••' : '')}
            />
          </FormField>
        ))}

        {/* Config-velden (niet-versleuteld) */}
        {configFields.length > 0 && (
          <div
            style={{
              marginTop: 4,
              marginBottom: 10,
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--theme-muted)',
            }}
          >
            Configuratie
          </div>
        )}
        {configFields.map((f) => (
          <FormField key={f.key} label={f.label} required={f.required} hint={f.hint}>
            <input
              type="text"
              value={configValues[f.key] ?? ''}
              onChange={(e) => setConfigValues((p) => ({ ...p, [f.key]: e.target.value }))}
              placeholder={f.placeholder ?? ''}
            />
          </FormField>
        ))}
      </form>
    </Drawer>
  );
}
