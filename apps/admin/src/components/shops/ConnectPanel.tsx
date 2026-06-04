/**
 * ConnectPanel — "Koppel je webshop" sectie op de shop-detail-pagina.
 *
 * Dit is de UX waarmee de operator zijn externe (statische) webshop in één stap
 * aan deze shop koppelt. Het paneel toont, voor DEZE shop:
 *   - slug + publieke storefront-API-base (`<API_PUBLIC_URL>/api/storefront/v1`)
 *   - een PUBLISHABLE storefront-token (de officiële headless-connect-weg, à la
 *     Shopify `X-Shopify-Storefront-Access-Token` / Medusa `x-publishable-api-key`):
 *     "Genereer/roteer token" (POST) toont de raw `wcrm_pk_...` token PRECIES ÉÉN
 *     KEER in een kopieerbaar veld met een waarschuwing; GET toont alleen
 *     `hasToken`; DELETE trekt 'm in.
 *   - een copy-paste <script type="module"> snippet met WebshopCRM.init(...)
 *     prefilled met apiBase + (zodra gegenereerd) de storefrontToken — zodat de
 *     externe shop zich op de officiële manier authenticeert (slug blijft als
 *     back-compat fallback in de snippet staan).
 *   - een "allowed origins"-veld dat naar het own_webshop-kanaal van deze shop
 *     schrijft (config.allowedOrigins). Bestaat dat kanaal nog niet → knop
 *     "Koppel als kanaal" (POST /channels).
 *   - "Test verbinding" → GET /api/storefront/v1/health?shop=<slug> (groen/rood)
 *   - een checklist: shop actief? minstens 1 product gepubliceerd?
 *
 * Channel-config-shape spiegelt ChannelConfigDrawer.tsx:
 *   config.shopSlug : string  (koppelt kanaal aan deze storefront-slug)
 *   config.allowedOrigins : string[]  (CORS-allowlist)
 *
 * Storefront-token-endpoints (requireAuth, op /api/shops/:id/storefront-token):
 *   GET    → { hasToken: boolean }                    (nooit raw)
 *   POST   → { token: 'wcrm_pk_...', hasToken, rotated } (raw token ÉÉN keer)
 *   DELETE → { ok: true, hasToken: false }
 * De storefront-API resolvt een shop wanneer de request de header
 * `X-Storefront-Token: <token>` meestuurt (slug werkt als fallback).
 *
 * NB: de storefront-token-hooks staan HIER inline (ownership-scope: dit bestand),
 * met de gedeelde axios-instance + TanStack-Query, i.p.v. in `shops/api.ts`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  Plug,
  RotateCw,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { api, asApiError } from '@/lib/api';
import { FormField } from '@/components/ui/FormField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  useChannels,
  useCreateChannel,
  useUpdateChannel,
  type ChannelDetailDto,
} from '@/components/channels/api';
import { useShopProducts } from './api';
import type { ShopDto } from './types';

// ─── Storefront-token hooks (inline; ownership-scope is dit bestand) ──────────

const STOREFRONT_TOKEN_KEY = (shopId: string) =>
  ['shops-admin', 'storefront-token', shopId] as const;

/** GET presence-check: { hasToken } — nooit de raw token. */
function useStorefrontTokenState(shopId: string | undefined) {
  return useQuery({
    queryKey: STOREFRONT_TOKEN_KEY(shopId ?? '__none__'),
    queryFn: async (): Promise<{ hasToken: boolean }> => {
      const res = await api.get<{ hasToken: boolean }>(
        `/shops/${shopId}/storefront-token`,
      );
      return res.data;
    },
    enabled: !!shopId,
  });
}

/** POST genereer/roteer → raw token ÉÉN keer terug ({ token, hasToken, rotated }). */
function useGenerateStorefrontToken(shopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{
      token: string;
      hasToken: boolean;
      rotated: boolean;
    }> => {
      const res = await api.post<{
        token: string;
        hasToken: boolean;
        rotated: boolean;
      }>(`/shops/${shopId}/storefront-token`);
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(STOREFRONT_TOKEN_KEY(shopId), { hasToken: data.hasToken });
    },
  });
}

/** DELETE intrekken → { ok, hasToken:false }. */
function useRevokeStorefrontToken(shopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ ok: boolean; hasToken: boolean }> => {
      const res = await api.delete<{ ok: boolean; hasToken: boolean }>(
        `/shops/${shopId}/storefront-token`,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.setQueryData(STOREFRONT_TOKEN_KEY(shopId), { hasToken: false });
    },
  });
}

/**
 * Publieke origin waar de admin de API op aanspreekt. In dev praat de admin via
 * de vite-proxy met `/api`, maar de SDK-snippet + health-check moeten een
 * ABSOLUTE url gebruiken. We leiden die af van VITE_API_URL (zelfde target als
 * de proxy) en vallen terug op 127.0.0.1:7300.
 */
function resolvePublicApiOrigin(): string {
  const raw = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed || 'http://127.0.0.1:7300';
}

const API_ORIGIN = resolvePublicApiOrigin();
const STOREFRONT_BASE = `${API_ORIGIN}/api/storefront/v1`;

/** Vind het own_webshop-kanaal dat aan deze shop-slug gekoppeld is. */
function findOwnWebshopChannel(
  channels: ChannelDetailDto[] | undefined,
  slug: string,
): ChannelDetailDto | null {
  if (!channels) return null;
  return (
    channels.find(
      (c) =>
        c.type === 'own_webshop' &&
        ((c.config?.shopSlug as string | undefined) ?? '') === slug,
    ) ?? null
  );
}

function originsToString(cfg: Record<string, unknown> | undefined): string {
  const v = cfg?.allowedOrigins;
  if (Array.isArray(v)) return (v as string[]).join(', ');
  if (typeof v === 'string') return v;
  return '';
}

export function ConnectPanel({ shop }: { shop: ShopDto }) {
  const slug = shop.slug;

  // own_webshop-kanalen ophalen (niet shop-scoped → filter op type, match in JS).
  const channelsQuery = useChannels({ type: 'own_webshop', limit: 100, offset: 0 });
  const channel = findOwnWebshopChannel(channelsQuery.data?.items, slug);
  const channelId = channel?.id ?? '';

  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel(channelId);

  // Gepubliceerde producten van DEZE shop (admin-api, publishedOnly) — voor checklist.
  const publishedQuery = useShopProducts(shop.id, true);
  const publishedCount = publishedQuery.data?.total ?? publishedQuery.data?.items.length ?? 0;

  // Publishable storefront-token (de officiële headless-connect-weg).
  const tokenStateQuery = useStorefrontTokenState(shop.id);
  const hasToken = tokenStateQuery.data?.hasToken ?? false;
  const generateToken = useGenerateStorefrontToken(shop.id);
  const revokeToken = useRevokeStorefrontToken(shop.id);

  // De raw token wordt ÉÉN keer getoond (na POST), daarna nooit meer ophaalbaar.
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const [allowedOrigins, setAllowedOrigins] = useState('');
  const [test, setTest] = useState<
    { state: 'idle' } | { state: 'loading' } | { state: 'ok'; detail: string } | { state: 'fail'; detail: string }
  >({ state: 'idle' });

  // Sync het origins-veld met de kanaal-config zodra die geladen/gewijzigd is.
  useEffect(() => {
    setAllowedOrigins(originsToString(channel?.config));
  }, [channel?.id, channel?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // De snippet authenticeert op de OFFICIËLE manier (storefrontToken) zodra er
  // net één gegenereerd is. Anders tonen we een placeholder-regel zodat de
  // operator ziet WAAR het token moet — slug blijft als back-compat fallback.
  const snippet = useMemo(() => {
    const tokenLine = rawToken
      ? `    storefrontToken: '${rawToken}',`
      : hasToken
        ? `    storefrontToken: 'wcrm_pk_…', // genereer/roteer hierboven en plak hier`
        : `    storefrontToken: 'wcrm_pk_…', // genereer hierboven en plak hier`;
    return [
      `<script type="module">`,
      `  import './webshop-crm-sdk.js';`,
      `  WebshopCRM.init({`,
      `    apiBase: '${STOREFRONT_BASE}',`,
      tokenLine,
      `    shopSlug: '${slug}', // back-compat fallback`,
      `  });`,
      `</script>`,
    ].join('\n');
  }, [slug, rawToken, hasToken]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} gekopieerd`);
    } catch {
      toast.error('Kopiëren mislukt — selecteer en kopieer handmatig.');
    }
  }

  async function onCreateChannel() {
    try {
      await createChannel.mutateAsync({
        type: 'own_webshop',
        name: `${shop.name} — eigen webshop`,
        config: { shopSlug: slug },
      });
      toast.success(`Kanaal gekoppeld aan "${shop.name}"`);
    } catch (err) {
      toast.error(`Koppelen mislukt: ${asApiError(err).message}`);
    }
  }

  async function onSaveOrigins() {
    if (!channel) return;
    const origins = allowedOrigins
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const config: Record<string, unknown> = { ...channel.config };
    if (origins.length > 0) config.allowedOrigins = origins;
    else delete config.allowedOrigins;
    try {
      await updateChannel.mutateAsync({ config });
      toast.success('Allowed origins opgeslagen');
    } catch (err) {
      toast.error(`Opslaan mislukt: ${asApiError(err).message}`);
    }
  }

  async function onTest() {
    setTest({ state: 'loading' });
    const url = `${STOREFRONT_BASE}/health?shop=${encodeURIComponent(slug)}`;
    try {
      const res = await fetch(url, { method: 'GET' });
      let body: { ok?: boolean; shop?: string | null } = {};
      try {
        body = await res.json();
      } catch {
        /* niet-json antwoord */
      }
      if (res.ok && body.ok) {
        if (body.shop === slug) {
          setTest({ state: 'ok', detail: `Storefront bereikbaar — shop "${slug}" herkend.` });
        } else {
          setTest({
            state: 'fail',
            detail: `API bereikbaar, maar shop "${slug}" werd niet herkend (resolved: ${body.shop ?? 'null'}). Is de shop actief?`,
          });
        }
      } else {
        setTest({ state: 'fail', detail: `HTTP ${res.status} van ${url}` });
      }
    } catch (err) {
      setTest({
        state: 'fail',
        detail: `Geen verbinding met ${API_ORIGIN} — draait de API? (${err instanceof Error ? err.message : String(err)})`,
      });
    }
  }

  async function onGenerateToken() {
    try {
      const res = await generateToken.mutateAsync();
      setRawToken(res.token);
      toast.success(
        res.rotated ? 'Nieuw token gegenereerd — oude is ongeldig' : 'Storefront-token gegenereerd',
      );
    } catch (err) {
      toast.error(`Token genereren mislukt: ${asApiError(err).message}`);
    }
  }

  async function onRevokeToken() {
    try {
      await revokeToken.mutateAsync();
      setRawToken(null);
      toast.success('Storefront-token ingetrokken');
    } catch (err) {
      toast.error(`Intrekken mislukt: ${asApiError(err).message}`);
    }
  }

  const shopActive = shop.status === 'active';
  const hasPublished = publishedCount > 0;
  const tokenBusy = generateToken.isPending || revokeToken.isPending;

  return (
    <section style={{ marginTop: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Plug size={16} style={{ color: 'var(--theme-accent)' }} />
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Koppel je webshop</h2>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
        className="connect-grid"
      >
        {/* Linkerkolom: endpoint + snippet */}
        <div className="card">
          <div className="muted" style={LABEL}>
            Storefront-API
          </div>

          <FieldRow label="Shop-slug" value={slug} onCopy={() => void copy(slug, 'Slug')} />
          <FieldRow
            label="API-base"
            value={STOREFRONT_BASE}
            onCopy={() => void copy(STOREFRONT_BASE, 'API-base')}
          />

          {/* ── Publishable storefront-token (officiële headless-connect-weg) ── */}
          <div style={{ marginTop: 16 }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}
            >
              <KeyRound size={13} style={{ color: 'var(--theme-accent)' }} />
              <span
                className="muted"
                style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                Storefront-token
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11,
                }}
              >
                {tokenStateQuery.isLoading ? (
                  <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Loader2 size={12} className="spin" />
                    laden…
                  </span>
                ) : hasToken ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--success)' }}>
                    <CheckCircle2 size={13} />
                    Actief token
                  </span>
                ) : (
                  <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Circle size={13} />
                    Geen token
                  </span>
                )}
              </span>
            </div>

            <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, marginBottom: 10 }}>
              Een <strong>publishable</strong>, scope-beperkte sleutel (<code>wcrm_pk_…</code>) die je
              externe webshop bij elke storefront-call meestuurt via de header{' '}
              <code>X-Storefront-Token</code>. Veilig om in de browser te zetten — dit is{' '}
              <strong>niet</strong> je admin-login.
            </div>

            {/* Raw token wordt PRECIES ÉÉN keer getoond, direct na genereren. */}
            {rawToken && (
              <div
                style={{
                  marginBottom: 10,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'var(--theme-accent-subtle, var(--surface-2))',
                  border: '1px solid var(--theme-accent-border, var(--border-subtle))',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 7,
                    marginBottom: 8,
                    fontSize: 11.5,
                    lineHeight: 1.45,
                    color: 'var(--theme-accent)',
                  }}
                >
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    Dit token wordt <strong>maar één keer</strong> getoond. Kopieer en bewaar het nu —
                    daarna is het niet meer op te halen (alleen opnieuw te genereren).
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code
                    data-raw-token
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      fontFamily: 'var(--font-mono, monospace)',
                      color: 'var(--theme-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {rawToken}
                  </code>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void copy(rawToken, 'Token')}
                  >
                    <Copy size={12} />
                    Kopieer
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm btn-icon-leading"
                data-generate-token
                onClick={() => {
                  if (hasToken) setConfirmRotate(true);
                  else void onGenerateToken();
                }}
                disabled={tokenBusy}
              >
                {generateToken.isPending ? (
                  <Loader2 size={13} className="spin" />
                ) : hasToken ? (
                  <RotateCw size={13} />
                ) : (
                  <KeyRound size={13} />
                )}
                {generateToken.isPending
                  ? 'Bezig…'
                  : hasToken
                    ? 'Roteer token'
                    : 'Genereer token'}
              </button>
              {hasToken && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon-leading"
                  onClick={() => setConfirmRevoke(true)}
                  disabled={tokenBusy}
                  style={{ color: 'var(--danger)' }}
                >
                  <Trash2 size={13} />
                  Intrekken
                </button>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Terminal size={13} style={{ color: 'var(--theme-muted)' }} />
            <span className="muted" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Insluit-snippet
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => void copy(snippet, 'Snippet')}
            >
              <Copy size={12} />
              Kopieer
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: 11.5,
              lineHeight: 1.55,
              color: 'var(--theme-text)',
              fontFamily: 'var(--font-mono, monospace)',
              overflowX: 'auto',
              whiteSpace: 'pre',
            }}
          >
            <code>{snippet}</code>
          </pre>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>
            Plak dit in je statische webshop. De SDK (<code>webshop-crm-sdk.js</code>) leest producten,
            menu&apos;s en het winkelmandje. De officiële weg: vul de{' '}
            <strong>storefrontToken</strong> in (genereer hierboven) — die stuurt de SDK als{' '}
            <code>X-Storefront-Token</code> mee. De <code>shopSlug</code> blijft als back-compat fallback.
          </div>
        </div>

        {/* Rechterkolom: kanaal-koppeling + test + checklist */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Allowed origins / kanaal */}
          <div className="card">
            <div className="muted" style={LABEL}>
              Toegestane origins (CORS)
            </div>

            {channelsQuery.isLoading ? (
              <div className="muted" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={13} className="spin" />
                Kanaal laden…
              </div>
            ) : channel ? (
              <>
                <FormField hint="Komma-gescheiden URLs die de storefront-API mogen aanroepen.">
                  <input
                    type="text"
                    value={allowedOrigins}
                    onChange={(e) => setAllowedOrigins(e.target.value)}
                    placeholder="https://shop.voorbeeld.nl, https://www.voorbeeld.nl"
                  />
                </FormField>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void onSaveOrigins()}
                    disabled={updateChannel.isPending || allowedOrigins === originsToString(channel.config)}
                  >
                    {updateChannel.isPending ? 'Opslaan…' : 'Origins opslaan'}
                  </button>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    Kanaal: {channel.name}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>
                  Er is nog geen <strong>eigen-webshop-kanaal</strong> voor deze shop. Koppel er één om
                  origins te beheren en sync te activeren.
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm btn-icon-leading"
                  onClick={() => void onCreateChannel()}
                  disabled={createChannel.isPending}
                >
                  <Link2 size={13} />
                  {createChannel.isPending ? 'Koppelen…' : 'Koppel als kanaal'}
                </button>
              </>
            )}
          </div>

          {/* Test verbinding */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div className="muted" style={{ ...LABEL, marginBottom: 0 }}>
                Verbinding
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void onTest()}
                disabled={test.state === 'loading'}
              >
                {test.state === 'loading' ? (
                  <>
                    <Loader2 size={13} className="spin" />
                    Testen…
                  </>
                ) : (
                  'Test verbinding'
                )}
              </button>
            </div>
            {(test.state === 'ok' || test.state === 'fail') && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  fontSize: 12.5,
                  lineHeight: 1.45,
                  background: test.state === 'ok' ? 'var(--success-soft)' : 'var(--danger-soft)',
                  border: `1px solid ${test.state === 'ok' ? 'var(--success-border)' : 'var(--danger-border)'}`,
                  color: test.state === 'ok' ? 'var(--success)' : 'var(--danger)',
                }}
              >
                {test.state === 'ok' ? (
                  <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                ) : (
                  <XCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                )}
                <span>{test.detail}</span>
              </div>
            )}
          </div>

          {/* Checklist */}
          <div className="card">
            <div className="muted" style={LABEL}>
              Checklist
            </div>
            <ChecklistRow
              ok={shopActive}
              label="Shop is actief"
              detail={shopActive ? undefined : `Status is "${shop.status}" — zet op actief om live te gaan.`}
            />
            <ChecklistRow
              ok={hasPublished}
              loading={publishedQuery.isLoading}
              label="Minstens 1 product gepubliceerd"
              detail={
                publishedQuery.isLoading
                  ? 'Producten laden…'
                  : hasPublished
                    ? `${publishedCount} product(en) gepubliceerd`
                    : 'Publiceer producten via de matrix hieronder.'
              }
            />
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .connect-grid { grid-template-columns: 1fr !important; }
        }
        @keyframes connect-spin { to { transform: rotate(360deg); } }
        .connect-grid .spin, .connect-spin { animation: connect-spin 0.9s linear infinite; }
      `}</style>

      <ConfirmDialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        onConfirm={() => void onGenerateToken()}
        variant="primary"
        title="Token roteren?"
        confirmLabel="Roteer token"
        message={
          <>
            Er bestaat al een storefront-token voor deze shop. Bij roteren wordt het{' '}
            <strong>huidige token direct ongeldig</strong> — elke webshop die het nog gebruikt,
            verliest de verbinding tot je het nieuwe token plakt. Het nieuwe token zie je{' '}
            <strong>één keer</strong>.
          </>
        }
      />

      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={() => void onRevokeToken()}
        variant="danger"
        title="Token intrekken?"
        confirmLabel="Intrekken"
        message={
          <>
            Het storefront-token wordt verwijderd. Webshops die zich via{' '}
            <code>X-Storefront-Token</code> authenticeren verliezen de verbinding (de{' '}
            <code>shopSlug</code>-fallback blijft werken). Je kunt later een nieuw token genereren.
          </>
        }
      />
    </section>
  );
}

const LABEL: React.CSSProperties = {
  fontSize: 11.5,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 10,
};

function FieldRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 0',
        fontSize: 12.5,
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <span className="muted" style={{ minWidth: 72 }}>
        {label}
      </span>
      <code
        style={{
          flex: 1,
          minWidth: 0,
          color: 'var(--theme-text)',
          fontFamily: 'var(--font-mono, monospace)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </code>
      <button
        type="button"
        className="icon-btn"
        style={{ width: 28, height: 28, flexShrink: 0 }}
        onClick={onCopy}
        aria-label={`${label} kopiëren`}
        title="Kopieer"
      >
        <Copy size={13} />
      </button>
    </div>
  );
}

function ChecklistRow({
  ok,
  label,
  detail,
  loading,
}: {
  ok: boolean;
  label: string;
  detail?: string;
  loading?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '6px 0' }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>
        {loading ? (
          <Loader2 size={15} className="spin" style={{ color: 'var(--theme-muted)' }} />
        ) : ok ? (
          <CheckCircle2 size={15} style={{ color: 'var(--success)' }} />
        ) : (
          <Circle size={15} style={{ color: 'var(--theme-muted)' }} />
        )}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--theme-text)' }}>{label}</div>
        {detail && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 1, lineHeight: 1.4 }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}
