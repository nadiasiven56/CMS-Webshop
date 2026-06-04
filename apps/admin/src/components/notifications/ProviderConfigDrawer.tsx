/**
 * ProviderConfigDrawer — configureer credentials + afzender-config van één
 * e-mail-provider op de ECHTE API, met EXACT de officiële credential-velden per
 * provider zodat de operator de officiële route kan lopen en enkel keys hoeft te
 * plakken.
 *
 * Per provider-type:
 *   - smtp     : host / port / user / pass / secure         → PUT /:id/credentials
 *   - postmark : serverToken                                → PUT /:id/credentials
 *   - sendgrid : apiKey                                     → PUT /:id/credentials
 *   - mailgun  : apiKey (+ config.mailgunDomain)            → PUT /:id/credentials + PATCH {config}
 *
 * Afzender-config (alle providers): fromEmail / fromName / replyTo. Voor mailgun
 * óók mailgunDomain. Die slaan we op via PATCH {config} (NIET via /credentials —
 * het creds-schema stript onbekende velden).
 *
 * De masked presence-map (`provider.credentials`) toont welke velden al gezet
 * zijn; we tonen die als placeholder en laten ze leeg zodat een lege submit de
 * bestaande creds niet overschrijft (we sturen alleen ingevulde velden).
 *
 * "Test verbinding" en "Activeren" zijn echte calls; resultaat als toast +
 * invalidatie van de provider-list. Single-active-provider: na "Activeren" is
 * exact deze provider actief.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Star, XCircle } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import {
  useSetProviderCredentials,
  useUpdateProvider,
  useTestProviderConnection,
  useActivateProvider,
  providerMeta,
  type ProviderDto,
} from './api';

export function ProviderConfigDrawer({
  provider,
  onClose,
}: {
  provider: ProviderDto | null;
  onClose: () => void;
}) {
  const open = provider != null;
  // Stabiele id voor de hooks; lege string als gesloten (mutations idle).
  const providerId = provider?.id ?? '';

  const setCredentials = useSetProviderCredentials(providerId);
  const updateProvider = useUpdateProvider(providerId);
  const testConnection = useTestProviderConnection(providerId);
  const activate = useActivateProvider(providerId);

  // smtp creds
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  // postmark / sendgrid / mailgun creds
  const [serverToken, setServerToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  // afzender-config (alle providers)
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  // mailgun config
  const [mailgunDomain, setMailgunDomain] = useState('');
  // laatst geteste verbinding (sessie)
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  // "Officiële stappen" collapsible
  const [stepsOpen, setStepsOpen] = useState(false);

  useEffect(() => {
    if (!open || !provider) return;
    setSmtpHost('');
    setSmtpPort('587');
    setSmtpUser('');
    setSmtpPass('');
    setSmtpSecure(false);
    setServerToken('');
    setApiKey('');
    setMailgunDomain('');
    setStepsOpen(false);
    const cfg = provider.config ?? {};
    setFromEmail((cfg.fromEmail as string) ?? '');
    setFromName((cfg.fromName as string) ?? '');
    setReplyTo((cfg.replyTo as string) ?? '');
    setMailgunDomain((cfg.mailgunDomain as string) ?? '');
    setTestResult(null);
  }, [open, provider]);

  if (!provider) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const type = provider.provider;
  const meta = providerMeta(type);
  const has = (field: string) => provider.credentials[field] === 'set';
  const credPlaceholder = (field: string) =>
    has(field) ? '•••••••• (ingevuld — laat leeg om te behouden)' : '';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!provider) return;
    try {
      // 1) Afzender-config (+ mailgunDomain) altijd wegschrijven via PATCH {config}.
      const config: Record<string, unknown> = { ...provider.config };
      if (fromEmail.trim()) config.fromEmail = fromEmail.trim();
      else delete config.fromEmail;
      if (fromName.trim()) config.fromName = fromName.trim();
      else delete config.fromName;
      if (replyTo.trim()) config.replyTo = replyTo.trim();
      else delete config.replyTo;
      if (type === 'mailgun') {
        if (mailgunDomain.trim()) config.mailgunDomain = mailgunDomain.trim();
        else delete config.mailgunDomain;
      }
      await updateProvider.mutateAsync({ config });

      // 2) Credentials — alleen ingevulde velden (lege submit behoudt bestaande).
      const creds: Record<string, string | number | boolean> = {};
      if (type === 'smtp') {
        if (smtpHost.trim()) creds.host = smtpHost.trim();
        if (smtpPort.trim()) creds.port = Number(smtpPort.trim());
        if (smtpUser.trim()) creds.user = smtpUser.trim();
        if (smtpPass.trim()) creds.pass = smtpPass.trim();
        creds.secure = smtpSecure;
      } else if (type === 'postmark') {
        if (serverToken.trim()) creds.serverToken = serverToken.trim();
      } else if (type === 'sendgrid' || type === 'mailgun') {
        if (apiKey.trim()) creds.apiKey = apiKey.trim();
      }

      // De smtp-`secure`-boolean alleen tellen we niet mee als "echte" cred —
      // we vereisen minstens één tekst-veld voordat we /credentials aanroepen.
      const meaningfulKeys = Object.keys(creds).filter((k) => k !== 'secure');
      if (meaningfulKeys.length === 0) {
        // Config is opgeslagen; zonder creds activeert de provider niet.
        toast.success(
          `Afzender-instellingen ${provider.name} opgeslagen — vul credentials in om te verbinden.`,
        );
        onClose();
        return;
      }

      await setCredentials.mutateAsync(creds);
      toast.success(`Credentials ${provider.name} opgeslagen (versleuteld)`);
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Opslaan mislukt: ${e2.message}`);
    }
  }

  async function onTest() {
    if (!provider) return;
    setTestResult(null);
    try {
      const res = await testConnection.mutateAsync();
      setTestResult({ ok: res.ok, detail: res.detail });
      if (res.ok) toast.success(`${provider.name}: verbinding ok — ${res.detail}`);
      else toast.error(`${provider.name}: ${res.detail}`);
    } catch (err) {
      const e2 = asApiError(err);
      setTestResult({ ok: false, detail: e2.message });
      toast.error(`Test mislukt: ${e2.message}`);
    }
  }

  async function onActivate() {
    if (!provider) return;
    try {
      await activate.mutateAsync();
      toast.success(
        `${provider.name} is nu de actieve e-mail-provider — andere providers zijn gedeactiveerd.`,
      );
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Activeren mislukt: ${e2.message}`);
    }
  }

  const credFields = (() => {
    if (type === 'smtp') {
      return (
        <>
          <FormField label="Host" required hint="bv. smtp.jouwdomein.nl">
            <input
              type="text"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder={credPlaceholder('host') || 'smtp.voorbeeld.nl'}
            />
          </FormField>
          <FormField label="Poort" required hint="587 (STARTTLS) of 465 (SSL).">
            <input
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              placeholder="587"
              min={1}
              max={65535}
            />
          </FormField>
          <FormField label="Gebruiker" required>
            <input
              type="text"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              placeholder={credPlaceholder('user') || 'login@voorbeeld.nl'}
            />
          </FormField>
          <FormField label="Wachtwoord" required hint="Wordt versleuteld opgeslagen.">
            <input
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              placeholder={credPlaceholder('pass') || '••••••••'}
            />
          </FormField>
          <FormField label="TLS/SSL" hint="Aan voor poort 465 (impliciete SSL).">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={smtpSecure}
                onChange={(e) => setSmtpSecure(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Beveiligde verbinding (secure)
            </label>
          </FormField>
        </>
      );
    }
    if (type === 'postmark') {
      return (
        <FormField
          label="Server-token"
          required
          hint="Postmark → Server → API Tokens. Wordt versleuteld opgeslagen."
        >
          <input
            type="password"
            value={serverToken}
            onChange={(e) => setServerToken(e.target.value)}
            placeholder={credPlaceholder('serverToken') || '••••••••-••••-••••'}
          />
        </FormField>
      );
    }
    if (type === 'sendgrid') {
      return (
        <FormField
          label="API-key"
          required
          hint="SendGrid → Settings → API Keys (Mail Send-rechten)."
        >
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={credPlaceholder('apiKey') || 'SG.••••••••'}
          />
        </FormField>
      );
    }
    if (type === 'mailgun') {
      return (
        <>
          <FormField
            label="API-key"
            required
            hint="Mailgun → Settings → API Keys (Private API key)."
          >
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={credPlaceholder('apiKey') || '••••••••'}
            />
          </FormField>
          <FormField
            label="Verzend-domein"
            required
            hint="Je geverifieerde Mailgun-domein, bv. mg.voorbeeld.nl."
          >
            <input
              type="text"
              value={mailgunDomain}
              onChange={(e) => setMailgunDomain(e.target.value)}
              placeholder="mg.voorbeeld.nl"
            />
          </FormField>
        </>
      );
    }
    return (
      <div
        style={{
          padding: 12,
          background: 'var(--surface-2)',
          borderRadius: 8,
          fontSize: 12.5,
          color: 'var(--theme-muted)',
        }}
      >
        Geen configureerbare credential-velden voor dit provider-type.
      </div>
    );
  })();

  const officialSteps = OFFICIAL_STEPS[type];
  const saving = setCredentials.isPending || updateProvider.isPending;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={provider.name}
      subtitle={`${meta.label} • ${meta.kind}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleer
          </button>
          <button type="submit" form="provider-config" className="btn btn-primary" disabled={saving}>
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </>
      }
    >
      <form id="provider-config" onSubmit={onSubmit}>
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
              {provider.status === 'connected'
                ? 'Verbonden'
                : provider.status === 'error'
                  ? 'Fout'
                  : 'Niet verbonden'}
              {provider.isActive && (
                <span style={{ color: 'var(--theme-accent)', marginLeft: 8 }}>• actief</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void onTest()}
              disabled={testConnection.isPending}
            >
              {testConnection.isPending ? 'Testen…' : 'Test verbinding'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void onActivate()}
              disabled={activate.isPending || provider.isActive || provider.status !== 'connected'}
              title={
                provider.isActive
                  ? 'Deze provider is al actief'
                  : provider.status !== 'connected'
                    ? 'Test eerst de verbinding (status moet "verbonden" zijn)'
                    : 'Maak dit de actieve provider'
              }
            >
              <Star size={13} />
              {provider.isActive ? 'Actief' : activate.isPending ? 'Activeren…' : 'Activeren'}
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

        {(provider.status === 'disconnected' || provider.status === 'error') && (
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
            Vul de credentials in, klik op <strong>Test verbinding</strong> en daarna op{' '}
            <strong>Activeren</strong> om transactionele mail via deze provider te versturen.
          </div>
        )}

        {/* Officiële stappen (collapsible) */}
        {officialSteps && (
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
              Officiële stappen — {officialSteps.title}
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
                {officialSteps.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* Credentials */}
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 600,
            color: 'var(--theme-muted)',
            marginBottom: 8,
          }}
        >
          Credentials
        </div>
        {credFields}

        {/* Afzender-config */}
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 600,
            color: 'var(--theme-muted)',
            margin: '18px 0 8px',
          }}
        >
          Afzender
        </div>
        <FormField label="Afzender-e-mail" hint="Het 'van'-adres voor uitgaande mail.">
          <input
            type="email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="no-reply@voorbeeld.nl"
          />
        </FormField>
        <FormField label="Afzender-naam">
          <input
            type="text"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="Jouw Webshop"
          />
        </FormField>
        <FormField label="Reply-to" hint="Optioneel — waar antwoorden heen gaan.">
          <input
            type="email"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            placeholder="klantenservice@voorbeeld.nl"
          />
        </FormField>
      </form>
    </Drawer>
  );
}

// ─── Officiële onboarding-stappen per provider ───────────────────
const OFFICIAL_STEPS: Record<string, { title: string; steps: string[] } | undefined> = {
  postmark: {
    title: 'Postmark',
    steps: [
      'Maak een account op postmarkapp.com en verifieer je afzender-domein.',
      'Maak een Server aan (of gebruik een bestaande).',
      'Server → API Tokens → kopieer het Server API token.',
      'Plak het token hier en klik op Test verbinding.',
    ],
  },
  sendgrid: {
    title: 'SendGrid',
    steps: [
      'Maak een account op sendgrid.com en doorloop Sender Authentication.',
      'Settings → API Keys → Create API Key (rechten: Mail Send).',
      'Kopieer de key (zichtbaar bij aanmaken) en plak hem hier.',
      'Klik op Test verbinding.',
    ],
  },
  mailgun: {
    title: 'Mailgun',
    steps: [
      'Maak een account op mailgun.com en voeg een verzend-domein toe.',
      'Verifieer het domein (DNS-records: SPF, DKIM, MX).',
      'Settings → API Keys → kopieer de Private API key.',
      'Vul de key + het verzend-domein hier in en klik op Test verbinding.',
    ],
  },
  smtp: {
    title: 'SMTP',
    steps: [
      'Verzamel host, poort, gebruikersnaam en wachtwoord van je mailserver.',
      'Poort 587 = STARTTLS (secure uit); poort 465 = SSL (secure aan).',
      'Vul de velden hier in en klik op Test verbinding.',
      'NB: SMTP-verzending is een scaffold — de test controleert of de config compleet is.',
    ],
  },
};
