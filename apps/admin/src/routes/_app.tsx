import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from '@tanstack/react-router';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { ToastContainer, useToasts } from '@/components/ui/Toast';
import { UndoSnackbarContainer } from '@/components/ui/UndoSnackbar';
import { ShortcutHelpModal } from '@/components/ShortcutHelpModal';
import { CommandPalette, openCommandPalette } from '@/components/CommandPalette';
import { useKeyboardShortcuts } from '@/lib/use-keyboard-shortcuts';
import { ShopProvider } from '@/lib/shop-context';
import { api, asApiError } from '@/lib/api';
import { AUTH_QUERY_KEY, type AuthUser } from '@/lib/auth';
import { DEMO_MODE, MOCK_USER } from '@/lib/mock-data';

/**
 * Route-afhankelijke "Nieuw"-actie voor de `n`-shortcut. Stuurt de gebruiker
 * naar de relevante create-flow op lijst-pagina's. Geeft null wanneer er geen
 * zinvolle create-actie is voor de huidige route.
 */
function newActionFor(pathname: string): string | null {
  if (pathname === '/products' || pathname.startsWith('/products')) return '/products/new';
  if (pathname.startsWith('/orders')) return '/orders';
  if (pathname.startsWith('/customers')) return '/customers';
  return null;
}

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    // In demo-mode: skip auth-check (er is geen backend) en seed mock-user
    if (DEMO_MODE) {
      const cached = context.queryClient.getQueryData<AuthUser | null>([...AUTH_QUERY_KEY]);
      if (!cached) {
        context.queryClient.setQueryData<AuthUser>([...AUTH_QUERY_KEY], { ...MOCK_USER });
      }
      return;
    }

    // Echte auth-check
    const cached = context.queryClient.getQueryData<AuthUser | null>([...AUTH_QUERY_KEY]);
    if (cached) return;

    try {
      const res = await api.get<{ user: AuthUser }>('/auth/me');
      context.queryClient.setQueryData([...AUTH_QUERY_KEY], res.data.user);
    } catch (err) {
      const e = asApiError(err);
      if (e.status === 401) {
        throw redirect({
          to: '/login',
          search: { from: location.href },
        });
      }
      console.error('auth-check failed', e);
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const { toasts, dismiss } = useToasts();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Globale shortcuts: '/' opent command-palette (snelzoek), 'n' = nieuw op
  // lijst-pagina's. ('?' = help, Ctrl+S/Esc worden elders afgehandeld.)
  useKeyboardShortcuts(
    {
      '/': () => openCommandPalette(),
      n: () => {
        const target = newActionFor(pathname);
        if (target) void navigate({ to: target });
      },
    },
    [pathname],
  );

  return (
    <ShopProvider>
      <div className="app-shell">
        <Sidebar />
        <main className="app-main">
          <TopBar />
          <div className="app-content">
            <Outlet />
          </div>
        </main>
        <ToastContainer toasts={toasts} onDismiss={dismiss} />
        <UndoSnackbarContainer />
        <ShortcutHelpModal />
        <CommandPalette />
      </div>
    </ShopProvider>
  );
}
