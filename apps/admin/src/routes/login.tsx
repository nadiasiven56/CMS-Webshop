import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useLogin, AUTH_QUERY_KEY, type AuthUser } from '@/lib/auth';
import { api, asApiError } from '@/lib/api';
import { DEMO_MODE, MOCK_USER, DEMO_CREDENTIALS } from '@/lib/mock-data';

export const Route = createFileRoute('/login')({
  // Als al ingelogd, redirect naar dashboard
  beforeLoad: async ({ context }) => {
    const cached = context.queryClient.getQueryData<AuthUser | null>([...AUTH_QUERY_KEY]);
    if (cached) {
      throw redirect({ to: '/launch' });
    }
    if (DEMO_MODE) {
      // In DEMO_MODE: laat login-screen tonen (operator kan demo-creds invullen).
      // De _app-guard auto-seedt al een mock-user als ze direct naar `/` gaan zonder login.
      return;
    }
    // Probe one-shot
    try {
      const res = await api.get<{ user: AuthUser }>('/auth/me');
      context.queryClient.setQueryData([...AUTH_QUERY_KEY], res.data.user);
      throw redirect({ to: '/launch' });
    } catch (err) {
      const e = asApiError(err);
      if (e.status !== 401) {
        // andere error: laat login tonen
      }
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    if (DEMO_MODE) {
      // Simulate ~800ms login-flow zodat de UI loading-state realistisch voelt
      await new Promise((r) => setTimeout(r, 800));
      try {
        await login.mutateAsync({ email: email || DEMO_CREDENTIALS.email, password: password || DEMO_CREDENTIALS.password });
        if (remember && typeof window !== 'undefined') {
          localStorage.setItem('webshop-crm:demo-auth', '1');
        }
        void navigate({ to: '/launch' });
      } catch {
        setError('Demo-mode: er ging iets mis bij seed van mock-user.');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    try {
      await login.mutateAsync({ email, password });
      void navigate({ to: '/launch' });
    } catch (err) {
      const e = asApiError(err);
      setError(
        e.status === 401
          ? 'E-mail of wachtwoord onjuist.'
          : `Er ging iets mis: ${e.message}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo() {
    setEmail(DEMO_CREDENTIALS.email);
    setPassword(DEMO_CREDENTIALS.password);
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand" style={{ borderBottom: 'none', marginBottom: 28, padding: 0 }}>
          <div className="brand-mark">W</div>
          <div>
            <div className="brand-name">Webshop-CRM</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>
              Admin paneel
            </div>
          </div>
        </div>
        <h1>Inloggen</h1>
        <p className="subtitle">Voer je credentials in om toegang te krijgen.</p>

        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={login.isPending || submitting}
            placeholder="jij@webshop-crm.local"
          />
        </div>

        <div className="field">
          <label htmlFor="password">Wachtwoord</label>
          <div className="password-wrapper">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={login.isPending || submitting}
              placeholder="••••••••"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Verberg wachtwoord' : 'Toon wachtwoord'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            color: 'var(--theme-muted)',
            marginBottom: 4,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ width: 14, height: 14, padding: 0 }}
          />
          Onthoud me op dit apparaat
        </label>

        {error && <p className="error-text">{error}</p>}

        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 16 }}
          disabled={login.isPending || submitting}
        >
          {(login.isPending || submitting) ? 'Bezig…' : 'Inloggen'}
        </button>

        {DEMO_MODE && (
          <div className="login-hint">
            <strong style={{ display: 'block', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--theme-accent)' }}>
              Demo Mode
            </strong>
            Backend is offline — elke combinatie werkt. Probeer:
            <br />
            <code>{DEMO_CREDENTIALS.email}</code> · <code>{DEMO_CREDENTIALS.password}</code>
            <button
              type="button"
              onClick={fillDemo}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--theme-accent)',
                fontSize: 11.5,
                cursor: 'pointer',
                padding: 0,
                marginTop: 6,
                display: 'block',
                textDecoration: 'underline',
              }}
            >
              Demo-credentials invullen
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
