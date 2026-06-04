/**
 * AccountingConfigDrawer — configureer credentials + config van één boekhoud-
 * koppeling op de ECHTE API, met EXACT de officiele credential-velden per
 * provider zodat de operator later "de officiele route" loopt en enkel keys
 * hoeft te plakken.
 *
 * Mirror van channels/ChannelConfigDrawer, maar veld-gedreven via providerMeta:
 *   - moneybird   : { accessToken } + config.administrationId
 *   - exact       : { accessToken, refreshToken, clientId, clientSecret } + config.division
 *   - eboekhouden : { username, securityCode1, securityCode2 }
 *
 * De masked presence-map (`connection.credentials`) toont welke velden al gezet
 * zijn; we tonen die als placeholder en laten ze leeg zodat een lege submit de
 * bestaande creds NIET overschrijft (we sturen alleen ingevulde velden).
 *
 * "Test verbinding" en "Synchroniseren" zijn echte calls; resultaat wordt als
 * toast getoond en de detail/list-query wordt geinvalideerd.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCcw,
  XCircle,
} from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import {
  useSetCredentials,
  useUpdateConnection,
  useTestConnection,
  useSyncConnection,
  providerMeta,
  type AccountingConnectionDetailDto,
} from './api';

export function AccountingConfigDrawer({
  connection,
  onClose,
}: {
  connection: AccountingConnectionDetailDto | null;
  onClose: () => void;
}) {
  const open = connection != null;
  // Stabiele id voor de hooks; lege string als gesloten (mutations idle).
  const connectionId = connection?.id ?? '';

  const setCredentials = useSetCredentials(connectionId);
  const updateConnection = useUpdateConnection(connectionId);
  const testConnection = useTestConnection(connectionId);
  const syncConnection = useSyncConnection(connectionId);

  const meta = useMemo(
    () => providerMeta(connection?.provider ?? ''),
    [connection?.provider],
  );

  // Dynamische form-state per veld-key (creds + config).
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  // Sync-scope
  const [syncScope, setSyncScope] = useState<'invoices' | 'orders'>('invoices');
  // laatst geteste verbinding (sessie)
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  // "Officiele stappen" collapsible
  const [stepsOpen, setStepsOpen] = useState(false);

  useEffect(() => {
    if (!open || !connection) return;
    setCredValues({});
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    const nextConfig: Record<string, string> = {};
    for (const field of meta.configFields) {
      const v = cfg[field.key];
      nextConfig[field.key] = typeof v === 'string' ? v : v != null ? String(v) : '';
    }
    setConfigValues(nextConfig);
    setSyncScope('invoices');
    setStepsOpen(false);
    setTestResult(null);
  }, [open, connection, meta]);

  if (!connection) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const has = (field: string) => connection.credentials[field] === 'set';
  const credPlaceholder = (field: string, fallback?: string) =>
    has(field) ? 'Gezet (laat leeg om te behouden)' : (fallback ?? '');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!connection) return;
    try {
      // 1) config (jsonb) — alleen meeschrijven als er config-velden bestaan.
      if (meta.configFields.length > 0) {
        const config: Record<string, unknown> = { ...connection.config };
        for (const field of meta.configFields) {
          const val = (configValues[field.key] ?? '').trim();
          if (val) config[field.key] = val;
          else delete config[field.key];
        }
        await updateConnection.mutateAsync({ config });
      }

      // 2) credentials — alleen ingevulde velden versturen (leeg = behouden).
      const creds: Record<string, string> = {};
      for (const field of meta.credentialFields) {
        const val = (credValues[field.key] ?? '').trim();
        if (val) creds[field.key] = val;
      }

      if (Object.keys(creds).length === 0) {
        if (meta.configFields.length > 0) {
          toast.success(
            `Instellingen ${connection.name} opgeslagen — vul credentials in om te activeren.`,
          );
          onClose();
          return;
        }
        toast.error('Vul minstens een credential-veld in.');
        return;
      }

      // Bij een EERSTE set valideert de backend ALLE verplichte velden. Als er
      // nog geen creds zijn moet de operator dus het hele formulier invullen.
      if (!connection.hasCredentials) {
        const missing = meta.credentialFields
          .filter((f) => f.required && !creds[f.key])
          .map((f) => f.label);
        if (missing.length > 0) {
          toast.error(`Vul ook in: ${missing.join(', ')}.`);
          return;
        }
      }

      await setCredentials.mutateAsync(creds);
      toast.success(`Credentials ${connection.name} opgeslagen (versleuteld)`);
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Opslaan mislukt: ${e2.message}`);
    }
  }

  async function onTest() {
    if (!connection) return;
    setTestResult(null);
    try {
      const res = await testConnection.mutateAsync();
      setTestResult({ ok: res.ok, detail: res.detail });
      if (res.ok) toast.success(`${connection.name}: verbinding ok — ${res.detail}`);
      else toast.error(`${connection.name}: ${res.detail}`);
    } catch (err) {
      const e2 = asApiError(err);
      setTestResult({ ok: false, detail: e2.message });
      toast.error(`Test mislukt: ${e2.message}`);
    }
  }

  async function onSync() {
    if (!connection) return;
    try {
      const res = await syncConnection.mutateAsync({ scope: syncScope });
      const parts = [`${res.pushed} gepusht`, `${res.skipped} overgeslagen`];
      if (res.errors.length > 0) {
        toast.error(
          `${connection.name} gesynchroniseerd met ${res.errors.length} fout(en): ${res.errors[0]}`,
        );
      } else {
        toast.success(`${connection.name}: ${parts.join(', ')}`);
      }
    } catch (err) {
      const e2 = asApiError(err);
      if (e2.code === 'accounting_not_connected') {
        toast.error(
          `${connection.name} is niet verbonden — voer credentials in en test eerst.`,
        );
      } else {
        toast.error(`Synchronisatie mislukt: ${e2.message}`);
      }
    }
  }

  const saving = setCredentials.isPending || updateConnection.isPending;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={connection.name}
      subtitle={`Configuratie • ${meta.kind}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleer
          </button>
          <button
            type="submit"
            form="acc-config"
            className="btn btn-primary"
            disabled={saving}
          >
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </>
      }
    >
      <form id="acc-config" onSubmit={onSubmit}>
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
              {connection.status === 'connected'
                ? 'Verbonden'
                : connection.status === 'error'
                  ? 'Fout'
                  : 'Niet verbonden'}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void onTest()}
            disabled={testConnection.isPending}
          >
            {testConnection.isPending ? 'Testen…' : 'Test verbinding'}
          </button>
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

        {(connection.status === 'disconnected' || connection.status === 'error') && (
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
            Vul de credentials in en klik op <strong>Test verbinding</strong> om deze
            koppeling te activeren.
          </div>
        )}

        {/* Officiele stappen (collapsible) — waar haal je de tokens vandaan. */}
        {meta.steps.items.length > 0 && (
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
              Waar vind ik de tokens? — {meta.steps.title}
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
                {meta.steps.items.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* Credential-velden */}
        {meta.credentialFields.map((field) => (
          <FormField
            key={field.key}
            label={field.label}
            required={field.required}
            hint={field.hint}
          >
            <input
              type={field.secret ? 'password' : 'text'}
              value={credValues[field.key] ?? ''}
              onChange={(e) =>
                setCredValues((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
              placeholder={credPlaceholder(field.key, field.placeholder)}
              autoComplete="off"
            />
          </FormField>
        ))}

        {/* Config-velden (jsonb) */}
        {meta.configFields.length > 0 && (
          <div
            style={{
              marginTop: 4,
              marginBottom: 8,
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
              color: 'var(--theme-muted)',
            }}
          >
            Instellingen
          </div>
        )}
        {meta.configFields.map((field) => (
          <FormField key={field.key} label={field.label} hint={field.hint}>
            <input
              type="text"
              value={configValues[field.key] ?? ''}
              onChange={(e) =>
                setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
              placeholder={field.placeholder}
            />
          </FormField>
        ))}

        {/* Synchroniseren — alleen zinvol als verbonden. */}
        <div
          style={{
            marginTop: 8,
            padding: '12px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            background: 'var(--surface-2)',
          }}
        >
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--theme-text)',
              marginBottom: 8,
            }}
          >
            Synchroniseren
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={syncScope}
              onChange={(e) => setSyncScope(e.target.value as 'invoices' | 'orders')}
              style={{ padding: '7px 10px', fontSize: 13 }}
              aria-label="Sync-scope"
            >
              <option value="invoices">Facturen</option>
              <option value="orders">Orders</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void onSync()}
              disabled={syncConnection.isPending || connection.status !== 'connected'}
              title={
                connection.status !== 'connected'
                  ? 'Verbind eerst (credentials + test) om te synchroniseren'
                  : undefined
              }
            >
              <RefreshCcw size={13} className={syncConnection.isPending ? 'spin' : ''} />
              {syncConnection.isPending ? 'Synchroniseren…' : 'Synchroniseren'}
            </button>
          </div>
          <p
            style={{
              margin: '8px 0 0',
              fontSize: 11.5,
              color: 'var(--theme-muted)',
              lineHeight: 1.45,
            }}
          >
            Pusht facturen of orders naar {meta.label}. Idempotent — reeds gesynchroniseerde
            items worden overgeslagen.
          </p>
        </div>
      </form>
    </Drawer>
  );
}
