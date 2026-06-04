/**
 * /settings (index) — Account & Sessie.
 *
 * Dit is de INDEX-route van het settings-layout (settings.tsx). De gedeelde
 * "Settings"-header en de tab-navigatie worden door de layout gerenderd; deze
 * index toont enkel de eigen content (account-gegevens + uitlog-actie) in de
 * outlet.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAuth, useLogout } from '@/lib/auth';

export const Route = createFileRoute('/_app/settings/')({
  component: SettingsAccountPage,
});

function SettingsAccountPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const logout = useLogout();

  async function onLogout() {
    await logout.mutateAsync();
    void navigate({ to: '/login' });
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h2 className="card-title">Account</h2>
        </div>
        <div className="row" style={{ gap: 8, color: 'var(--theme-muted)' }}>
          <span>E-mail:</span>
          <strong style={{ color: 'var(--theme-text)' }}>
            {auth.data?.email ?? '—'}
          </strong>
        </div>
        <div className="row" style={{ gap: 8, color: 'var(--theme-muted)', marginTop: 6 }}>
          <span>Rol:</span>
          <span className="pill pill-accent">{auth.data?.role ?? '—'}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Sessie</h2>
            <div className="card-subtitle">Log uit op deze browser.</div>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onLogout}
          disabled={logout.isPending}
        >
          {logout.isPending ? 'Uitloggen…' : 'Uitloggen'}
        </button>
      </div>
    </div>
  );
}
