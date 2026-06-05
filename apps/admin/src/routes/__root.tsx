import {
  createRootRouteWithContext,
  Link,
  Outlet,
  ScrollRestoration,
} from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  errorComponent: RootErrorComponent,
});

function RootComponent() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

/**
 * Root-level error-boundary. Vangt render-fouten die anders een leeg scherm
 * zouden geven en toont een nette, themed melding met herstel-acties.
 */
function RootErrorComponent({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--theme-bg)',
        color: 'var(--theme-text)',
      }}
    >
      <div
        className="card"
        role="alert"
        style={{ maxWidth: 460, width: '100%', textAlign: 'center', padding: 28 }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 14px',
            background: 'var(--danger-subtle, rgba(239,68,68,0.12))',
            color: 'var(--danger)',
          }}
        >
          <AlertTriangle size={24} />
        </div>
        <h1 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600 }}>
          Er ging iets mis
        </h1>
        <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--theme-muted)' }}>
          De pagina kon niet correct worden geladen. Probeer het opnieuw of ga
          terug naar het dashboard.
        </p>
        <pre
          style={{
            textAlign: 'left',
            fontSize: 11.5,
            background: 'var(--surface-2, rgba(0,0,0,0.2))',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            padding: '8px 10px',
            margin: '0 0 16px',
            maxHeight: 140,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--theme-muted)',
          }}
        >
          {message}
        </pre>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            Opnieuw proberen
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.location.reload()}
          >
            Pagina herladen
          </button>
          <Link to="/" className="btn btn-ghost">
            Naar dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
