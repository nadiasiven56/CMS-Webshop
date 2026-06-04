/**
 * useAuth + helpers — react-query gebaseerd. Eén `auth.me` query die
 * gedeeld wordt door layout-guard en sidebar.
 *
 * In demo-mode wordt mock-data gebruikt zodat de UI altijd ingelogd is.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, asApiError } from './api';
import { DEMO_MODE, MOCK_USER } from './mock-data';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export const AUTH_QUERY_KEY = ['auth', 'me'] as const;

async function fetchMe(): Promise<AuthUser | null> {
  if (DEMO_MODE) {
    return { ...MOCK_USER };
  }
  try {
    const res = await api.get<{ user: AuthUser }>('/auth/me');
    return res.data.user;
  } catch (err) {
    const e = asApiError(err);
    if (e.status === 401) return null;
    // Geen backend? Val terug op mock zodat UI bruikbaar is.
    if (e.status === 0) return { ...MOCK_USER };
    throw err;
  }
}

export function useAuth() {
  const query = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: 60_000,
    refetchOnMount: true,
  });
  return query;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      if (DEMO_MODE) {
        // Accept any creds in demo
        return { ...MOCK_USER, email: input.email || MOCK_USER.email };
      }
      const res = await api.post<{ user: AuthUser }>('/auth/login', input);
      return res.data.user;
    },
    onSuccess: (user) => {
      qc.setQueryData<AuthUser>(AUTH_QUERY_KEY, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!DEMO_MODE) {
        try {
          await api.post('/auth/logout');
        } catch {
          // best-effort
        }
      }
    },
    onSettled: () => {
      qc.setQueryData(AUTH_QUERY_KEY, null);
      qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      if (typeof window !== 'undefined') {
        localStorage.removeItem('webshop-crm:demo-auth');
      }
    },
  });
}
