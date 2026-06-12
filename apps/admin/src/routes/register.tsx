/**
 * /register — publieke registratiepagina voor tenant-accounts (role 'user').
 *
 * Zelfde look & feel als /login (login-screen/login-card). Succesvolle
 * registratie (POST /api/auth/register → 201 + sessie-cookie) logt direct in
 * en redirect naar het dashboard, waar de onboarding-empty-state ("Maak je
 * eerste shop") de nieuwe tenant verder helpt.
 */
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useRegister, AUTH_QUERY_KEY, type AuthUser } from '@/lib/auth';
import { api, asApiError } from '@/lib/api';
import { DEMO_MODE } from '@/lib/mock-data';

export const Route = createFileRoute('/register')({
  // Al ingelogd? Dan heeft registreren geen zin → door naar de app.
  beforeLoad: async ({ context }) => {
    const cached = context.queryClient.getQueryData<AuthUser | null>([...AUTH_QUERY_KEY]);
    if (cached) {
      throw redirect({ to: '/launch' });
    }
    if (DEMO_MODE) return;
    // De redirect mag NIET binnen de try: hij wordt als throw door de eigen
    // catch opgeslokt en de ingelogde user bleef dan op het formulier hangen.
    let me: AuthUser | null = null;
    try {
      const res = await api.get<{ user: AuthUser }>('/auth/me');
      me = res.data.user;
    } catch (err) {
      const e = asApiError(err);
      if (e.status !== 401) {
        // andere error: laat de registratiepagina gewoon tonen
      }
    }
    if (me) {
      context.queryClient.setQueryData([...AUTH_QUERY_KEY], me);
      throw redirect({ to: '/launch' });
    }
  },
  component: RegisterPage,
});

const MIN_PASSWORD_LENGTH = 8;

function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; repeat?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const errs: { password?: string; repeat?: string } = {};
    if (password.length < MIN_PASSWORD_LENGTH) {
      errs.password = `Wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn.`;
    }
    if (passwordRepeat !== password) {
      errs.repeat = 'Wachtwoorden komen niet overeen.';
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      if (DEMO_MODE) {
        // Simuleer korte server-roundtrip zodat de loading-state realistisch voelt.
        await new Promise((r) => setTimeout(r, 600));
      }
      await register.mutateAsync({ email, password });
      // 201 + sessie-cookie = direct ingelogd → naar het dashboard.
      void navigate({ to: '/' });
    } catch (err) {
      const apiErr = asApiError(err);
      setError(
        apiErr.code === 'email_taken' || apiErr.status === 409
          ? 'Dit e-mailadres is al in gebruik. Log in of gebruik een ander adres.'
          : apiErr.status === 429
            ? 'Te veel pogingen — probeer het over een paar minuten opnieuw.'
            : `Registreren mislukt: ${apiErr.message}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  const busy = register.isPending || submitting;

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
        <h1>Account aanmaken</h1>
        <p className="subtitle">Maak een account aan en koppel daarna je eigen webshop.</p>

        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            placeholder="jij@jouwshop.nl"
          />
        </div>

        <div className="field">
          <label htmlFor="password">Wachtwoord</label>
          <div className="password-wrapper">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              placeholder="Minimaal 8 tekens"
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
          {fieldErrors.password && <p className="error-text">{fieldErrors.password}</p>}
        </div>

        <div className="field">
          <label htmlFor="password-repeat">Wachtwoord herhalen</label>
          <input
            id="password-repeat"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={passwordRepeat}
            onChange={(e) => setPasswordRepeat(e.target.value)}
            disabled={busy}
            placeholder="••••••••"
          />
          {fieldErrors.repeat && <p className="error-text">{fieldErrors.repeat}</p>}
        </div>

        {error && <p className="error-text">{error}</p>}

        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 16 }}
          disabled={busy}
        >
          {busy ? 'Bezig…' : 'Account aanmaken'}
        </button>

        <p
          style={{
            marginTop: 16,
            marginBottom: 0,
            fontSize: 12.5,
            color: 'var(--theme-muted)',
            textAlign: 'center',
          }}
        >
          Al een account?{' '}
          <Link to="/login" style={{ color: 'var(--theme-accent)' }}>
            Inloggen
          </Link>
        </p>
      </form>
    </div>
  );
}
