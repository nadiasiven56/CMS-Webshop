/**
 * ChannelConfigDrawer — configureer credentials/config van één kanaal op de
 * ECHTE API, met EXACT de officiële credential-velden per marketplace zodat de
 * operator later "de officiële route" kan lopen en enkel keys hoeft te plakken.
 *
 * Per channel-type:
 *   - bol        : clientId / clientSecret            → PUT /:id/credentials
 *                  + config.environment ('demo'|'production') → PATCH /:id {config}
 *   - amazon     : clientId(LWA) / clientSecret(LWA) / refreshToken / sellerId
 *                                                      → PUT /:id/credentials
 *                  + config.marketplaceIds / region / environment → PATCH {config}
 *   - gmc        : merchantId / serviceAccountJson    → PUT /:id/credentials
 *   - own_webshop: shopSlug / allowedOrigins (config) → PATCH /:id (config)
 *
 * WIRE-CONTRACT NB (geverifieerd live tegen de API):
 *   De backend-zod (`AmazonCredentialsSchema`) valideert de LWA-keys onder de
 *   namen `clientId`/`clientSecret` (de SP-API-adapter behandelt die als
 *   `lwaClientId`/`lwaClientSecret` — officiële aliassen). We tonen daarom de
 *   OFFICIËLE labels ("LWA Client ID / Client Secret") maar versturen de keys die
 *   de gevalideerde schema accepteert. `marketplaceIds`/`region`/`environment`
 *   worden door de adapter uit `channel.config` gelezen (config wint), dus die
 *   slaan we op via PATCH {config}, NIET via /credentials (de creds-schema str/ipt
 *   ze).
 *
 * De masked presence-map (`channel.credentials`) toont welke velden al gezet
 * zijn; we tonen die als placeholder en laten ze leeg zodat een lege submit de
 * bestaande creds niet overschrijft (we sturen alleen ingevulde velden).
 *
 * "Test connection" en "Sync nu" zijn echte calls; resultaat wordt als toast
 * getoond en de detail/list-query wordt geïnvalideerd.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, RefreshCcw, XCircle } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import {
  useSetCredentials,
  useUpdateChannel,
  useTestConnection,
  useSyncChannel,
  channelTypeMeta,
  type ChannelDetailDto,
} from './api';

// ─── Amazon marketplace-opties (mirror van backend _spapi-client MARKETPLACES) ─
// Default = NL. EU-buren als snelle multiselect; verder vrij als komma-lijst.
const AMAZON_MARKETPLACES: Array<{ code: string; id: string; label: string }> = [
  { code: 'NL', id: 'A1805IZSGTT6HS', label: 'NL — Amazon.nl' },
  { code: 'DE', id: 'A1PA6795UKMFR9', label: 'DE — Amazon.de' },
  { code: 'FR', id: 'A13V1IB3VIYZZH', label: 'FR — Amazon.fr' },
  { code: 'BE', id: 'AMEN7PMS3EDWL', label: 'BE — Amazon.com.be' },
];
const DEFAULT_MARKETPLACE_ID = 'A1805IZSGTT6HS'; // NL

export function ChannelConfigDrawer({
  channel,
  onClose,
}: {
  channel: ChannelDetailDto | null;
  onClose: () => void;
}) {
  const open = channel != null;
  // Stabiele id voor de hooks; lege string als gesloten (queries/mutations idle).
  const channelId = channel?.id ?? '';

  const setCredentials = useSetCredentials(channelId);
  const updateChannel = useUpdateChannel(channelId);
  const testConnection = useTestConnection(channelId);
  const syncChannel = useSyncChannel(channelId);

  // bol creds
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  // bol config
  const [bolEnvironment, setBolEnvironment] = useState<'demo' | 'production'>('demo');
  // amazon creds (deelt clientId/clientSecret hierboven = LWA-keys)
  const [refreshToken, setRefreshToken] = useState('');
  const [sellerId, setSellerId] = useState('');
  // amazon config
  const [marketplaceIds, setMarketplaceIds] = useState<string>(DEFAULT_MARKETPLACE_ID);
  const [amazonRegion, setAmazonRegion] = useState<'eu' | 'na' | 'fe'>('eu');
  const [amazonEnvironment, setAmazonEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  // gmc
  const [merchantId, setMerchantId] = useState('');
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  // own_webshop config
  const [shopSlug, setShopSlug] = useState('');
  const [allowedOrigins, setAllowedOrigins] = useState('');
  // laatst geteste verbinding (sessie)
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  // "Officiële stappen" collapsible
  const [stepsOpen, setStepsOpen] = useState(false);

  useEffect(() => {
    if (!open || !channel) return;
    setClientId('');
    setClientSecret('');
    setRefreshToken('');
    setSellerId('');
    setMerchantId('');
    setServiceAccountJson('');
    setStepsOpen(false);
    const cfg = channel.config ?? {};
    // bol environment ('demo' default)
    setBolEnvironment((cfg.environment as string) === 'production' ? 'production' : 'demo');
    // amazon config
    const mids = cfg.marketplaceIds;
    setMarketplaceIds(
      Array.isArray(mids)
        ? (mids as string[]).join(', ')
        : typeof mids === 'string' && mids.trim()
          ? (mids as string)
          : DEFAULT_MARKETPLACE_ID,
    );
    setAmazonRegion(
      cfg.region === 'na' ? 'na' : cfg.region === 'fe' ? 'fe' : 'eu',
    );
    // amazon environment: officiële default 'sandbox' tot operator op production zet
    setAmazonEnvironment((cfg.environment as string) === 'production' ? 'production' : 'sandbox');
    // own_webshop
    setShopSlug((cfg.shopSlug as string) ?? '');
    setAllowedOrigins(
      Array.isArray(cfg.allowedOrigins)
        ? (cfg.allowedOrigins as string[]).join(', ')
        : ((cfg.allowedOrigins as string) ?? ''),
    );
    setTestResult(null);
  }, [open, channel]);

  if (!channel) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const type = channel.type;
  const meta = channelTypeMeta(type);
  const has = (field: string) => channel.credentials[field] === 'set';
  const credPlaceholder = (field: string) =>
    has(field) ? '•••••••• (ingevuld — laat leeg om te behouden)' : '';

  function parseCsv(value: string): string[] {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!channel) return;
    try {
      if (type === 'own_webshop') {
        const config: Record<string, unknown> = { ...channel.config };
        if (shopSlug.trim()) config.shopSlug = shopSlug.trim();
        else delete config.shopSlug;
        const origins = parseCsv(allowedOrigins);
        if (origins.length > 0) config.allowedOrigins = origins;
        else delete config.allowedOrigins;
        await updateChannel.mutateAsync({ config });
        toast.success(`Configuratie ${channel.name} opgeslagen`);
        onClose();
        return;
      }

      // Marketplaces / feed → eerst eventuele config (environment/region/
      // marketplaceIds) wegschrijven, daarna credentials. De backend valideert
      // verplichte credential-velden per type, dus bij een EERSTE set moet de
      // gebruiker alle vereiste velden invullen.
      if (type === 'bol') {
        // config.environment altijd meeschrijven (default 'demo').
        const config: Record<string, unknown> = { ...channel.config, environment: bolEnvironment };
        await updateChannel.mutateAsync({ config });
      } else if (type === 'amazon') {
        const config: Record<string, unknown> = { ...channel.config };
        const mids = parseCsv(marketplaceIds);
        if (mids.length > 0) config.marketplaceIds = mids;
        else delete config.marketplaceIds;
        config.region = amazonRegion;
        config.environment = amazonEnvironment;
        await updateChannel.mutateAsync({ config });
      }

      const creds: Record<string, string> = {};
      if (type === 'bol') {
        if (clientId.trim()) creds.clientId = clientId.trim();
        if (clientSecret.trim()) creds.clientSecret = clientSecret.trim();
      } else if (type === 'amazon') {
        // LWA-keys gaan over de draad als clientId/clientSecret (officiële
        // aliassen die de backend-schema valideert). refreshToken + sellerId
        // onder hun eigen naam.
        if (clientId.trim()) creds.clientId = clientId.trim();
        if (clientSecret.trim()) creds.clientSecret = clientSecret.trim();
        if (refreshToken.trim()) creds.refreshToken = refreshToken.trim();
        if (sellerId.trim()) creds.sellerId = sellerId.trim();
      } else if (type === 'gmc') {
        if (merchantId.trim()) creds.merchantId = merchantId.trim();
        if (serviceAccountJson.trim()) creds.serviceAccountJson = serviceAccountJson.trim();
      }

      if (Object.keys(creds).length === 0) {
        // own_webshop is hierboven al afgehandeld; voor marketplaces is de
        // config wel opgeslagen maar zonder creds activeert het kanaal niet.
        if (type === 'bol' || type === 'amazon') {
          toast.success(
            `Instellingen ${channel.name} opgeslagen — vul credentials in om te activeren.`,
          );
          onClose();
          return;
        }
        toast.error('Vul minstens één credential-veld in.');
        return;
      }

      await setCredentials.mutateAsync(creds);
      toast.success(`Credentials ${channel.name} opgeslagen (versleuteld)`);
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Opslaan mislukt: ${e2.message}`);
    }
  }

  async function onTest() {
    if (!channel) return;
    setTestResult(null);
    try {
      const res = await testConnection.mutateAsync();
      setTestResult({ ok: res.ok, detail: res.detail });
      if (res.ok) toast.success(`${channel.name}: verbinding ok — ${res.detail}`);
      else toast.error(`${channel.name}: ${res.detail}`);
    } catch (err) {
      const e2 = asApiError(err);
      setTestResult({ ok: false, detail: e2.message });
      toast.error(`Test mislukt: ${e2.message}`);
    }
  }

  async function onSync() {
    if (!channel) return;
    try {
      const res = await syncChannel.mutateAsync();
      const parts = [
        `${res.ordersImported} order(s) geïmporteerd`,
        `${res.listingsPushed} listing(s) gepusht`,
      ];
      if (res.errors.length > 0) {
        toast.error(`${channel.name} gesynced met ${res.errors.length} fout(en): ${res.errors[0]}`);
      } else {
        toast.success(`${channel.name}: ${parts.join(', ')}`);
      }
    } catch (err) {
      const e2 = asApiError(err);
      if (e2.code === 'channel_not_connected') {
        toast.error(`${channel.name} is niet verbonden — configureer credentials eerst.`);
      } else {
        toast.error(`Sync mislukt: ${e2.message}`);
      }
    }
  }

  const credFields = (() => {
    if (type === 'own_webshop') {
      return (
        <>
          <FormField label="Shop-slug" hint="Koppelt dit kanaal aan een storefront-slug.">
            <input
              type="text"
              value={shopSlug}
              onChange={(e) => setShopSlug(e.target.value)}
              placeholder="bijv. crema"
            />
          </FormField>
          <FormField label="Allowed origins" hint="CORS — komma-gescheiden URLs.">
            <input
              type="text"
              value={allowedOrigins}
              onChange={(e) => setAllowedOrigins(e.target.value)}
              placeholder="https://shop.voorbeeld.nl"
            />
          </FormField>
        </>
      );
    }
    if (type === 'bol') {
      return (
        <>
          <FormField label="Client ID" required hint="bol Retailer API — 'Client credentials'.">
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={credPlaceholder('clientId') || 'bijv. 1a2b3c4d-5e6f-...'}
            />
          </FormField>
          <FormField label="Client secret" required hint="Wordt versleuteld opgeslagen.">
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={credPlaceholder('clientSecret') || '••••••••'}
            />
          </FormField>
          <FormField
            label="Omgeving"
            hint="Start met 'demo' om te testen; zet op 'production' om live te gaan."
          >
            <select
              value={bolEnvironment}
              onChange={(e) => setBolEnvironment(e.target.value as 'demo' | 'production')}
            >
              <option value="demo">demo (test)</option>
              <option value="production">production (live)</option>
            </select>
          </FormField>
        </>
      );
    }
    if (type === 'amazon') {
      return (
        <>
          <FormField
            label="LWA Client ID"
            required
            hint="Login-with-Amazon app — client_id."
          >
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={credPlaceholder('clientId') || 'amzn1.application-oa2-client...'}
            />
          </FormField>
          <FormField label="LWA Client Secret" required hint="Wordt versleuteld opgeslagen.">
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={credPlaceholder('clientSecret') || '••••••••'}
            />
          </FormField>
          <FormField
            label="Refresh-token (LWA)"
            required
            hint="Via 'Authorize app' in Seller Central."
          >
            <input
              type="password"
              value={refreshToken}
              onChange={(e) => setRefreshToken(e.target.value)}
              placeholder={credPlaceholder('refreshToken') || 'Atza|••••••••'}
            />
          </FormField>
          <FormField label="Seller-ID (merchant)" hint="Optioneel — nodig voor listings-push.">
            <input
              type="text"
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
              placeholder={credPlaceholder('sellerId') || 'bijv. A2EXAMPLESELLER'}
            />
          </FormField>
          <FormField
            label="Marketplaces"
            hint="Komma-gescheiden marketplace-ids. Kies snel een EU-markt of typ zelf."
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {AMAZON_MARKETPLACES.map((m) => {
                const active = parseCsv(marketplaceIds).includes(m.id);
                return (
                  <button
                    key={m.code}
                    type="button"
                    onClick={() => {
                      const ids = parseCsv(marketplaceIds);
                      const next = active
                        ? ids.filter((x) => x !== m.id)
                        : [...ids, m.id];
                      setMarketplaceIds(next.join(', '));
                    }}
                    title={m.id}
                    style={{
                      padding: '5px 10px',
                      fontSize: 11.5,
                      fontWeight: 600,
                      borderRadius: 999,
                      cursor: 'pointer',
                      background: active ? 'var(--theme-accent-subtle)' : 'var(--surface-2)',
                      border: active
                        ? '1px solid var(--theme-accent-border)'
                        : '1px solid var(--border-default)',
                      color: active ? 'var(--theme-accent)' : 'var(--text-soft)',
                    }}
                  >
                    {m.code}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              value={marketplaceIds}
              onChange={(e) => setMarketplaceIds(e.target.value)}
              placeholder="A1805IZSGTT6HS"
            />
          </FormField>
          <FormField label="Regio" hint="NL/DE/FR/BE horen bij 'eu'.">
            <select
              value={amazonRegion}
              onChange={(e) => setAmazonRegion(e.target.value as 'eu' | 'na' | 'fe')}
            >
              <option value="eu">eu (Europa)</option>
              <option value="na">na (Noord-Amerika)</option>
              <option value="fe">fe (Verre Oosten)</option>
            </select>
          </FormField>
          <FormField
            label="Omgeving"
            hint="Test in 'sandbox'; zet op 'production' om live te gaan."
          >
            <select
              value={amazonEnvironment}
              onChange={(e) =>
                setAmazonEnvironment(e.target.value as 'sandbox' | 'production')
              }
            >
              <option value="sandbox">sandbox (test)</option>
              <option value="production">production (live)</option>
            </select>
          </FormField>
        </>
      );
    }
    if (type === 'gmc') {
      return (
        <>
          <FormField label="Merchant-ID" required>
            <input
              type="text"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
              placeholder={credPlaceholder('merchantId') || '123456789'}
            />
          </FormField>
          <FormField
            label="Service-account JSON"
            required
            hint="Plak de service-account-key (wordt versleuteld opgeslagen)."
          >
            <textarea
              value={serviceAccountJson}
              onChange={(e) => setServiceAccountJson(e.target.value)}
              placeholder={credPlaceholder('serviceAccountJson') || '{ "type": "service_account", ... }'}
              rows={4}
              style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11.5, resize: 'vertical' }}
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
        Geen configureerbare velden voor dit kanaal-type.
      </div>
    );
  })();

  const officialSteps = OFFICIAL_STEPS[type];

  const saving = setCredentials.isPending || updateChannel.isPending;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={channel.name}
      subtitle={`Configuratie • ${meta.kind}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleer
          </button>
          <button type="submit" form="ch-config" className="btn btn-primary" disabled={saving}>
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </>
      }
    >
      <form id="ch-config" onSubmit={onSubmit}>
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
              {channel.status === 'connected'
                ? 'Verbonden'
                : channel.status === 'error'
                  ? 'Fout'
                  : 'Niet verbonden'}
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
              onClick={() => void onSync()}
              disabled={syncChannel.isPending}
            >
              <RefreshCcw size={13} className={syncChannel.isPending ? 'spin' : ''} />
              {syncChannel.isPending ? 'Syncen…' : 'Sync nu'}
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

        {(channel.status === 'disconnected' || channel.status === 'error') &&
          type !== 'own_webshop' && (
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
              Vul de credentials in en klik op <strong>Test verbinding</strong> om dit kanaal te
              activeren.
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

        {credFields}
      </form>
    </Drawer>
  );
}

// ─── Officiële onboarding-stappen per type ───────────────────────
// Samenvatting van hoe je de keys bemachtigt zodat de operator de officiële
// route kan lopen en hier enkel hoeft te plakken.
const OFFICIAL_STEPS: Record<string, { title: string; steps: string[] } | undefined> = {
  bol: {
    title: 'bol Retailer API',
    steps: [
      'Ga naar partnerplatform.bol.com → Instellingen → API.',
      'Registreer een technisch contact.',
      "Kies 'Client credentials voor de Retailer API' → Aanmaken.",
      "Kopieer de Client ID en klik 'Toon secret' voor het Client secret.",
      "Test eerst met omgeving 'demo'; zet op 'production' om live te gaan.",
    ],
  },
  amazon: {
    title: 'Amazon SP-API',
    steps: [
      'Zorg voor een Professional seller-account (primary user).',
      'Seller Central → Apps & Services → Develop Apps → registreer als Private Developer.',
      "'Add new app client' (rollen: Orders + Inventory/Pricing) → noteer LWA client_id + client_secret.",
      "'Authorize app' → kopieer het refresh_token.",
      'Marketplace NL = A1805IZSGTT6HS, regio eu. Test in sandbox, dan production.',
    ],
  },
  own_webshop: undefined,
  gmc: undefined,
};
