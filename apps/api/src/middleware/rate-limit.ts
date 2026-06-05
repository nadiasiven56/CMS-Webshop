/**
 * Lichtgewicht in-memory rate-limiter (sliding-window, Map-based).
 *
 * Bewuste keuze: GEEN nieuwe dependency, GEEN Redis. Voor één API-instance
 * (zoals de prod-compose: één api-container achter Caddy) volstaat een proces-
 * lokale teller. Bij horizontaal schalen (meerdere api-replicas) zou je dit
 * willen vervangen door een gedeelde store; tot dan is dit een effectieve
 * eerste verdedigingslinie tegen brute-force / scraping.
 *
 * Sliding-window: per (keyPrefix + client-IP) houden we de timestamps van de
 * requests binnen `windowMs` bij. Bij elke hit verwijderen we verlopen entries
 * en tellen we wat over is. Boven `max` → 429 met `Retry-After`.
 *
 * UITGESCHAKELD wanneer `env.NODE_ENV === 'test'` zodat de testsuite (die veel
 * requests tegen dezelfde in-memory app vuurt) niet getriggerd wordt.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '../lib/env.js';

export interface RateLimitOptions {
  /** Lengte van het venster in milliseconden (bv. 15 * 60_000). */
  windowMs: number;
  /** Max. aantal requests per (IP) binnen het venster. */
  max: number;
  /** Namespace zodat verschillende limiters elkaars tellers niet delen. */
  keyPrefix: string;
}

/** Eén bucket = de timestamps (ms) van de requests binnen het venster. */
type Bucket = number[];

/**
 * Haal het client-IP uit `x-forwarded-for` (we draaien achter Caddy, die het
 * echte client-IP vooraan zet) met fallbacks naar `x-real-ip` en de remote-addr
 * die @hono/node-server in de context hangt. Onbekend → 'unknown' (alle
 * anonieme requests delen dan één bucket — bewust streng).
 */
function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    // X-Forwarded-For: client, proxy1, proxy2 → eerste is het origin-IP.
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xri = c.req.header('x-real-ip');
  if (xri) return xri.trim();
  // Fallback: de TCP-remote-addr (geen proxy-header aanwezig).
  try {
    const addr = getConnInfo(c).remote.address;
    if (addr) return addr;
  } catch {
    // getConnInfo werkt alleen onder @hono/node-server; negeer in andere envs.
  }
  return 'unknown';
}

/**
 * Factory: geeft een Hono-middleware die per (keyPrefix + client-IP) telt en
 * bij overschrijding 429 `{ error: 'rate_limited' }` + `Retry-After` teruggeeft.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const { windowMs, max, keyPrefix } = opts;

  // Per-limiter store. Module-scope zou kunnen, maar per-factory houdt de
  // namespaces strikt gescheiden en maakt 'm makkelijk los te testen.
  const store = new Map<string, Bucket>();

  // Periodieke opschoning zodat de Map niet onbeperkt groeit bij veel unieke
  // IP's. `unref()` zodat de timer de Node-process-exit niet blokkeert.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, bucket] of store) {
      const live = bucket.filter((t) => t > cutoff);
      if (live.length === 0) store.delete(k);
      else store.set(k, live);
    }
  }, windowMs);
  if (typeof sweep.unref === 'function') sweep.unref();

  return async (c, next) => {
    // In tests volledig uit — de in-memory app krijgt veel requests per IP.
    if (env.NODE_ENV === 'test') {
      return next();
    }

    const now = Date.now();
    const cutoff = now - windowMs;
    const key = `${keyPrefix}:${clientIp(c)}`;

    const bucket = (store.get(key) ?? []).filter((t) => t > cutoff);

    if (bucket.length >= max) {
      // Oudste request binnen het venster bepaalt wanneer er weer ruimte is.
      const oldest = bucket[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      c.header('Retry-After', String(retryAfterSec));
      // Bewaar de (ongewijzigde) bucket terug; we tellen de geweigerde request
      // NIET mee zodat een aanhoudende flood het venster niet eindeloos oprekt.
      store.set(key, bucket);
      return c.json({ error: 'rate_limited' }, 429);
    }

    bucket.push(now);
    store.set(key, bucket);

    return next();
  };
}
