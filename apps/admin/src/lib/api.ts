/**
 * Axios-instance voor de admin-frontend.
 *
 * `withCredentials: true` zorgt dat de session-cookie (HttpOnly) automatisch
 * meegaat. baseURL '/api' werkt via vite-proxy in dev (zie vite.config.ts).
 */
import axios, { AxiosError, AxiosHeaders } from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Voeg een Idempotency-Key header toe op POST/PUT/PATCH/DELETE als die nog
 * niet expliciet gezet is. UUID-v4 via crypto.randomUUID().
 */
api.interceptors.request.use((config) => {
  const method = (config.method || 'get').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    // Some axios versions return a plain object for headers, others AxiosHeaders.
    // Normalize and only set when not already provided.
    const headers = (config.headers ?? {}) as AxiosHeaders | Record<string, string>;
    const has =
      typeof (headers as AxiosHeaders).has === 'function'
        ? (headers as AxiosHeaders).has('idempotency-key')
        : Boolean((headers as Record<string, string>)['idempotency-key']);
    if (!has && typeof crypto !== 'undefined' && crypto.randomUUID) {
      const key = crypto.randomUUID();
      if (typeof (headers as AxiosHeaders).set === 'function') {
        (headers as AxiosHeaders).set('Idempotency-Key', key);
      } else {
        (headers as Record<string, string>)['Idempotency-Key'] = key;
      }
      config.headers = headers as AxiosHeaders;
    }
  }
  return config;
});

export type ApiError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

export function isApiError(err: unknown): err is AxiosError<{ error: string; message?: string }> {
  return axios.isAxiosError(err);
}

export function asApiError(err: unknown): ApiError {
  if (isApiError(err)) {
    return {
      status: err.response?.status ?? 0,
      code: err.response?.data?.error ?? 'network_error',
      message: err.response?.data?.message ?? err.message,
      details: err.response?.data,
    };
  }
  return {
    status: 0,
    code: 'unknown_error',
    message: err instanceof Error ? err.message : String(err),
  };
}
