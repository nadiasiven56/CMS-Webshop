/**
 * CarrierConfigDrawer — configureer credentials/config van één vervoerder op de
 * ECHTE API, met EXACT de officiële credential-velden per carrier-code zodat de
 * operator later "de officiële route" kan lopen en enkel keys hoeft te plakken.
 *
 * Spiegelt channels/ChannelConfigDrawer.tsx:
 *   - per-code credential-velden (uit CARRIER_CREDENTIAL_FIELDS) → PUT /:id/credentials
 *   - config.environment ('sandbox'|'production') → PATCH /:id {config}
 *   - "Test verbinding" → POST /:id/test-connection → status-pill + result-banner
 *   - masked presence-map (`carrier.credentials`) toont WELKE velden al gezet
 *     zijn als placeholder; leeg laten = behoud bestaande creds (we sturen alleen
 *     ingevulde velden).
 *
 * dhl heeft (nog) geen credential-schema/adapter → we tonen een nette melding.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import {
  useSetCarrierCredentials,
  useUpdateCarrier,
  useTestCarrier,
  carrierMeta,
  CARRIER_CREDENTIAL_FIELDS,
  CARRIER_ONBOARDING,
  type CarrierDetailDto,
  type CarrierCode,
} from './api';

const KNOWN_CODES: CarrierCode[] = ['sendcloud', 'myparcel', 'postnl', 'dhl'];

function isKnownCode(code: string): code is CarrierCode {
  return (KNOWN_CODES as string[]).includes(code);
}

export function CarrierConfigDrawer({
  carrier,
  onClose,
}: {
  carrier: CarrierDetailDto | null;
  onClose: () => void;
}) {
  const open = carrier != null;
  // Stabiele id voor de hooks; lege string als gesloten (mutations idle).
  const carrierId = carrier?.id ?? '';

  const setCredentials = useSetCarrierCredentials(carrierId);
  const updateCarrier = useUpdateCarrier(carrierId);
  const testCarrier = useTestCarrier(carrierId);

  // Credential-velden als losse string-state, gekeyed op veld-key.
  const [values, setValues] = useState<Record<string, string>>({});
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  // laatst geteste verbinding (sessie)
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  // "Officiële stappen" collapsible
  const [stepsOpen, setStepsOpen] = useState(false);

  useEffect(() => {
    if (!open || !carrier) return;
    setValues({});
    setStepsOpen(false);
    setTestResult(null);
    const cfg = carrier.config ?? {};
    setEnvironment((cfg.environment as string) === 'production' ? 'production' : 'sandbox');
  }, [open, carrier]);

  if (!carrier) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const code = carrier.code;
  const meta = carrierMeta(code);
  const fields = isKnownCode(code) ? CARRIER_CREDENTIAL_FIELDS[code] : [];
  const onboarding = isKnownCode(code) ? CARRIER_ONBOARDING[code] : undefined;
  const supportsCredentials = fields.length > 0;

  const has = (field: string) => carrier.credentials[field] === 'set';
  const credPlaceholder = (f: { key: string; placeholder?: string }) =>
    has(f.key) ? '•••••••• (ingevuld — laat leeg om te behouden)' : (f.placeholder ?? '');

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!carrier) return;
    try {
      // environment altijd meeschrijven via config (default 'sandbox').
      const config: Record<string, unknown> = { ...carrier.config, environment };
      await updateCarrier.mutateAsync({ config });

      if (!supportsCredentials) {
        toast.success(`Instellingen ${carrier.name} opgeslagen`);
        onClose();
        return;
      }

      const creds: Record<string, string> = {};
      for (const f of fields) {
        const v = (values[f.key] ?? '').trim();
        if (v) creds[f.key] = v;
      }

      if (Object.keys(creds).length === 0) {
        toast.success(
          `Instellingen ${carrier.name} opgeslagen — vul credentials in om te activeren.`,
        );
        onClose();
        return;
      }

      const res = await setCredentials.mutateAsync(creds);
      if (res.verify.ok) {
        toast.success(`${carrier.name}: verbonden — ${res.verify.detail}`);
      } else {
        toast.error(`${carrier.name}: credentials opgeslagen maar verificatie faalde — ${res.verify.detail}`);
      }
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Opslaan mislukt: ${e2.message}`);
    }
  }

  async function onTest() {
    if (!carrier) return;
    setTestResult(null);
    try {
      const res = await testCarrier.mutateAsync();
      setTestResult({ ok: res.ok, detail: res.detail });
      if (res.ok) toast.success(`${carrier.name}: verbinding ok — ${res.detail}`);
      else toast.error(`${carrier.name}: ${res.detail}`);
    } catch (err) {
      const e2 = asApiError(err);
      setTestResult({ ok: false, detail: e2.message });
      toast.error(`Test mislukt: ${e2.message}`);
    }
  }

  const saving = setCredentials.isPending || updateCarrier.isPending;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={carrier.name}
      subtitle={`Configuratie • ${meta.kind}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleer
          </button>
          <button type="submit" form="carrier-config" className="btn btn-primary" disabled={saving}>
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </>
      }
    >
      <form id="carrier-config" onSubmit={onSubmit}>
        {/* Connect-status + test-actie */}
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
              {carrier.status === 'connected'
                ? 'Verbonden'
                : carrier.status === 'error'
                  ? 'Fout'
                  : 'Niet verbonden'}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void onTest()}
            disabled={testCarrier.isPending || !supportsCredentials}
            title={supportsCredentials ? undefined : 'Geen verbindingstest voor dit type'}
          >
            {testCarrier.isPending ? 'Testen…' : 'Test verbinding'}
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

        {supportsCredentials &&
          (carrier.status === 'disconnected' || carrier.status === 'error') && (
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
              Vul de credentials in en klik op <strong>Opslaan</strong> — de verbinding wordt
              automatisch geverifieerd. Of klik op <strong>Test verbinding</strong> om opnieuw te
              testen.
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

        {/* Credential-velden per code */}
        {supportsCredentials ? (
          <>
            {fields.map((f) => (
              <FormField key={f.key} label={f.label} required={f.required} hint={f.hint}>
                <input
                  type={f.type}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValue(f.key, e.target.value)}
                  placeholder={credPlaceholder(f) || (f.type === 'password' ? '••••••••' : '')}
                />
              </FormField>
            ))}
            <FormField
              label="Omgeving"
              hint="Test in 'sandbox'; zet op 'production' om live labels te maken."
            >
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')}
              >
                <option value="sandbox">sandbox (test)</option>
                <option value="production">production (live)</option>
              </select>
            </FormField>
          </>
        ) : (
          <div
            style={{
              padding: 12,
              background: 'var(--surface-2)',
              borderRadius: 8,
              fontSize: 12.5,
              color: 'var(--theme-muted)',
              lineHeight: 1.5,
            }}
          >
            Voor <strong>{meta.label}</strong> is er nog geen credential-koppeling beschikbaar. Je
            kunt de vervoerder wel aanmaken en later koppelen zodra de adapter klaar is.
          </div>
        )}
      </form>
    </Drawer>
  );
}
