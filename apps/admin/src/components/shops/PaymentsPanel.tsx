/**
 * PaymentsPanel — "Betalingen" sectie op de shop-detail-pagina (Wave-H A4).
 *
 * Hiermee koppelt de operator een Payment Service Provider (PSP) aan DEZE shop,
 * zodat de storefront-checkout echte betalingen kan aanmaken i.p.v. het offline
 * mock-paid-pad. V1 ondersteunt Mollie (de backend implementeert de officiële
 * Mollie Payments API v2 — zie apps/api/src/domain/payments/mollie.ts).
 *
 * Officiële route ("plak je key"):
 *   - provider-select: Geen | Mollie
 *   - API-key-veld (password): accepteert `test_…` (testmodus) en `live_…` (live).
 *     De bestaande key wordt NOOIT teruggetoond — alleen of er één gezet is.
 *   - Save → PATCH /api/shops/:id met het EXACTE contract dat de backend-factory
 *     leest: { paymentProvider:'mollie', paymentCredentials:{ apiKey } }.
 *
 * Zonder PSP-key blijft de webshop 'test-betaald' (mock-paid): de checkout-flow
 * is volledig functioneel, maar er gaat niets naar een PSP.
 *
 * NB: de admin schrijft naar het contract dat `getPaymentProvider(shop)` leest.
 * Accepteert de shops-PATCH-route die velden (nog) niet, dan vangen we dat met
 * een duidelijke melding op — de UX blijft ongewijzigd zodra de write-kant landt.
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import { FormField } from '@/components/ui/FormField';
import { useUpdateShopPayments } from './api';
import type { ShopDto } from './types';

type Provider = 'none' | 'mollie';

/** Detecteer modus uit de key-prefix (matcht MollieProvider.isTestMode). */
function keyMode(key: string): 'test' | 'live' | 'unknown' {
  const k = key.trim();
  if (k.startsWith('test_')) return 'test';
  if (k.startsWith('live_')) return 'live';
  return 'unknown';
}

export function PaymentsPanel({ shop }: { shop: ShopDto }) {
  const update = useUpdateShopPayments(shop.id);

  // De DTO geeft de key/provider (terecht) NIET terug. We tonen daarom presence
  // op basis van wat in deze sessie is opgeslagen; bij page-load is dat onbekend.
  const [provider, setProvider] = useState<Provider>('none');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  // Of er (voor zover deze sessie weet) een key gezet is voor de gekozen provider.
  const [keySet, setKeySet] = useState(false);

  // Reset lokale state als we naar een andere shop kijken.
  useEffect(() => {
    setProvider('none');
    setApiKey('');
    setShowKey(false);
    setKeySet(false);
  }, [shop.id]);

  const mode = keyMode(apiKey);
  const keyInvalid = apiKey.trim().length > 0 && mode === 'unknown';

  // Wat verandert er? Save is alleen zinvol als provider wisselt of een (geldige)
  // nieuwe key wordt ingevuld.
  const wantsMollie = provider === 'mollie';
  const hasNewKey = apiKey.trim().length > 0;
  const canSave =
    !update.isPending &&
    !keyInvalid &&
    // Mollie kiezen vereist een key tenzij er al één gezet is.
    ((wantsMollie && (hasNewKey || keySet)) ||
      // 'Geen' kiezen koppelt los — alleen zinvol als er iets gezet was.
      (!wantsMollie && keySet));

  async function onSave() {
    if (!canSave) return;
    try {
      if (!wantsMollie) {
        // Loskoppelen: provider + credentials op null.
        await update.mutateAsync({ paymentProvider: null, paymentCredentials: null });
        setKeySet(false);
        setApiKey('');
        toast.success('PSP losgekoppeld — webshop staat weer op test-betaald (mock).');
        return;
      }
      // Mollie: stuur de key alleen mee als er een nieuwe is ingevuld.
      await update.mutateAsync({
        paymentProvider: 'mollie',
        ...(hasNewKey ? { paymentCredentials: { apiKey: apiKey.trim() } } : {}),
      });
      if (hasNewKey) {
        setKeySet(true);
        setApiKey('');
        setShowKey(false);
      }
      toast.success(
        hasNewKey
          ? `Mollie-key opgeslagen (${mode === 'live' ? 'LIVE' : 'testmodus'}).`
          : 'Mollie als PSP ingesteld.',
      );
    } catch (err) {
      const e = asApiError(err);
      // De shops-PATCH-route accepteert deze velden mogelijk nog niet (dan strip
      // Zod ze → 'invalid_request' met "at least one field required"). Maak dat
      // expliciet zodat het geen mysterieuze fout lijkt.
      const msg =
        e.code === 'invalid_request'
          ? 'Opslaan mislukt — de shops-API accepteert PSP-velden nog niet. ' +
            'Zie de notitie hieronder.'
          : e.message || 'Opslaan mislukt';
      toast.error(msg);
    }
  }

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <CreditCard size={16} style={{ color: 'var(--theme-accent)' }} />
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Betalingen</h2>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
        className="payments-grid"
      >
        {/* Linkerkolom: provider + key + save */}
        <div className="card">
          <div className="muted" style={LABEL}>
            Payment Service Provider
          </div>

          <FormField
            label="Provider"
            hint="Mollie verwerkt echte betalingen. Zonder provider blijft de webshop op test-betaald (mock)."
          >
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
            >
              <option value="none">Geen (test-betaald / mock)</option>
              <option value="mollie">Mollie</option>
            </select>
          </FormField>

          {provider === 'mollie' && (
            <>
              <FormField
                label={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <KeyRound size={13} />
                    Mollie API-key
                  </span>
                }
                hint="Begint met test_ (testmodus) of live_ (live). Plak je key uit my.mollie.com → Developers → API keys."
                error={keyInvalid ? 'Een Mollie-key begint met test_ of live_.' : undefined}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={keySet ? 'Key is ingesteld — laat leeg om te behouden' : 'test_… of live_…'}
                    autoComplete="off"
                    spellCheck={false}
                    style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono, monospace)' }}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ width: 32, height: 32, flexShrink: 0 }}
                    onClick={() => setShowKey((s) => !s)}
                    aria-label={showKey ? 'Key verbergen' : 'Key tonen'}
                    title={showKey ? 'Verberg' : 'Toon'}
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </FormField>

              {/* Modus-indicatie op basis van de prefix. */}
              {hasNewKey && !keyInvalid && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: -4,
                    marginBottom: 12,
                    padding: '8px 10px',
                    borderRadius: 8,
                    fontSize: 12,
                    background: mode === 'live' ? 'var(--danger-soft)' : 'var(--success-soft)',
                    border: `1px solid ${mode === 'live' ? 'var(--danger-border)' : 'var(--success-border)'}`,
                    color: mode === 'live' ? 'var(--danger)' : 'var(--success)',
                  }}
                >
                  {mode === 'live' ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
                  <span>
                    {mode === 'live'
                      ? 'LIVE-key — echte betalingen worden verwerkt en afgeschreven.'
                      : 'Testmodus — veilig om mee te bouwen, er wordt niets echt afgeschreven.'}
                  </span>
                </div>
              )}

              {/* Presence van een reeds gezette key (zonder de waarde te tonen). */}
              {keySet && !hasNewKey && (
                <div
                  className="muted"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 12 }}
                >
                  <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                  Er is een key ingesteld voor deze shop. Laat het veld leeg om die te behouden.
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void onSave()}
              disabled={!canSave}
            >
              {update.isPending ? 'Opslaan…' : 'Opslaan'}
            </button>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {provider === 'none'
                ? 'Geen PSP gekozen — checkout blijft test-betaald.'
                : 'Echte betalingen via Mollie.'}
            </span>
          </div>
        </div>

        {/* Rechterkolom: officiële Mollie-stappen */}
        <div className="card">
          <div className="muted" style={LABEL}>
            Officiële stappen (Mollie)
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: 'var(--theme-text)' }}>
            <li>
              Maak een account op{' '}
              <a
                href="https://www.mollie.com"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--theme-accent)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
              >
                mollie.com <ExternalLink size={11} />
              </a>{' '}
              en ga naar{' '}
              <a
                href="https://my.mollie.com/dashboard/developers/api-keys"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--theme-accent)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
              >
                my.mollie.com → Developers → API keys <ExternalLink size={11} />
              </a>
              .
            </li>
            <li>
              De <strong>test-key</strong> (<code>test_…</code>) is direct beschikbaar — plak die hierboven
              om te bouwen &amp; testen.
            </li>
            <li>
              Rond de <strong>organisatie- / UBO-verificatie</strong> af in je Mollie-dashboard.
            </li>
            <li>
              Daarna komt de <strong>live-key</strong> (<code>live_…</code>) beschikbaar — vul die in om
              live te gaan.
            </li>
          </ol>

          <div
            className="muted"
            style={{
              marginTop: 14,
              padding: '10px 12px',
              borderRadius: 8,
              fontSize: 11.5,
              lineHeight: 1.5,
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            Zolang er geen key is, blijft de webshop <strong>test-betaald</strong>: de checkout werkt,
            maar er gaat niets naar Mollie. De key wordt versleuteld opgeslagen en nooit teruggetoond.
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .payments-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

const LABEL: React.CSSProperties = {
  fontSize: 11.5,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 10,
};
