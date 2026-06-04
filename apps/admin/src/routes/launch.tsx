/**
 * Launch — het "kies je winkel"-startscherm (multi-store entry).
 *
 * Staat BUITEN de _app-shell (geen sidebar/topbar) zodat het een rustig,
 * overzichtelijk startpunt is na login. Hergebruikt de bestaande shops-data
 * (SHOPS_QUERY_KEY) en zet de gekozen shop via persistActiveShop() in
 * localStorage; de ShopProvider in _app pikt die op bij mount.
 */
import { createFileRoute, useNavigate, Link, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Store, Plus, ArrowRight, Check } from 'lucide-react';
import { listShops } from '@/lib/api-with-fallback';
import { api, asApiError } from '@/lib/api';
import { AUTH_QUERY_KEY, type AuthUser } from '@/lib/auth';
import { DEMO_MODE, MOCK_USER } from '@/lib/mock-data';
import {
  SHOPS_QUERY_KEY,
  persistActiveShop,
  ACTIVE_SHOP_LS_KEY,
  type Shop,
} from '@/lib/shop-context';

export const Route = createFileRoute('/launch')({
  // Zelfde auth-guard als de _app-shell: in demo door, anders sessie vereist.
  beforeLoad: async ({ context, location }) => {
    if (DEMO_MODE) {
      const cached = context.queryClient.getQueryData<AuthUser | null>([...AUTH_QUERY_KEY]);
      if (!cached) {
        context.queryClient.setQueryData<AuthUser>([...AUTH_QUERY_KEY], { ...MOCK_USER });
      }
      return;
    }
    const cached = context.queryClient.getQueryData<AuthUser | null>([...AUTH_QUERY_KEY]);
    if (cached) return;
    try {
      const res = await api.get<{ user: AuthUser }>('/auth/me');
      context.queryClient.setQueryData([...AUTH_QUERY_KEY], res.data.user);
    } catch (err) {
      const e = asApiError(err);
      if (e.status === 401) {
        throw redirect({ to: '/login', search: { from: location.href } });
      }
    }
  },
  component: LaunchPage,
});

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active: { label: 'Live', cls: 'live' },
  live: { label: 'Live', cls: 'live' },
  published: { label: 'Live', cls: 'live' },
  draft: { label: 'Concept', cls: 'draft' },
  concept: { label: 'Concept', cls: 'draft' },
  paused: { label: 'Gepauzeerd', cls: 'paused' },
  archived: { label: 'Gearchiveerd', cls: 'draft' },
};

const EMOJI_SET = ['🛍️', '☕', '🐶', '👶', '👙', '🌿', '🎧', '📦', '👟', '💄', '🌸', '🍫'];

function emojiFor(shop: Shop): string {
  const branding = shop.branding as { emoji?: string } | undefined;
  if (branding?.emoji) return branding.emoji;
  let h = 0;
  for (const c of shop.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return EMOJI_SET[h % EMOJI_SET.length]!;
}

function LaunchPage() {
  const navigate = useNavigate();
  const current =
    typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_SHOP_LS_KEY) : null;

  const { data: shops = [], isLoading } = useQuery({
    queryKey: SHOPS_QUERY_KEY,
    queryFn: () => listShops(),
    staleTime: 30_000,
  });

  function choose(id: string) {
    persistActiveShop(id);
    void navigate({ to: '/' });
  }

  return (
    <div className="launch-screen">
      <header className="launch-top">
        <div className="brand" style={{ border: 'none', padding: 0, margin: 0 }}>
          <div className="brand-mark">W</div>
          <div>
            <div className="brand-name">Webshop-CRM</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>
              Multi-store admin
            </div>
          </div>
        </div>
        <Link to="/shops" className="launch-newbtn">
          <Plus size={15} /> Nieuwe store
        </Link>
      </header>

      <div className="launch-body">
        <div className="launch-head">
          <h1>Kies je winkel</h1>
          <p>
            {isLoading
              ? 'Winkels laden…'
              : `Je beheert ${shops.length} ${shops.length === 1 ? 'winkel' : 'winkels'}. Klik er een om verder te gaan.`}
          </p>
        </div>

        {isLoading ? (
          <div className="launch-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="launch-card launch-card-skel" />
            ))}
          </div>
        ) : shops.length === 0 ? (
          <div className="launch-empty">
            <Store size={34} />
            <h3>Nog geen winkels</h3>
            <p>Maak je eerste winkel aan om te beginnen.</p>
            <Link to="/shops" className="btn btn-primary">
              <Plus size={15} /> Winkel toevoegen
            </Link>
          </div>
        ) : (
          <div className="launch-grid">
            {shops.map((s) => {
              const key = (s.status ?? '').toString().toLowerCase();
              const st = STATUS_MAP[key] ?? { label: s.status ?? '—', cls: 'draft' };
              const isCurrent = s.id === current;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`launch-card${st.cls !== 'live' ? ' is-draft' : ''}`}
                  onClick={() => choose(s.id)}
                >
                  <div className="launch-card-top">
                    <div className="launch-ava">{emojiFor(s)}</div>
                    <div className="launch-meta">
                      <b>{s.name}</b>
                      <small>{s.domain ?? `${s.slug}`}</small>
                    </div>
                    <span className={`launch-status ${st.cls}`}>
                      {st.cls === 'live' ? '● ' : ''}
                      {st.label}
                    </span>
                  </div>
                  <div className="launch-chips">
                    {s.currency && <span className="launch-chip">{s.currency}</span>}
                    {s.locale && <span className="launch-chip">{s.locale}</span>}
                    {isCurrent && (
                      <span className="launch-chip current">
                        <Check size={11} /> laatst gebruikt
                      </span>
                    )}
                  </div>
                  <div className="launch-go">
                    Open winkel <ArrowRight size={15} />
                  </div>
                </button>
              );
            })}
            <Link to="/shops" className="launch-card launch-add">
              <Plus size={26} />
              <span>Nieuwe store</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
