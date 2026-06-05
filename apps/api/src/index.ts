/**
 * Webshop-CRM — API entrypoint.
 *
 * Boot:
 *   - Hono-app met /health + /api/* (zie routes/index.ts)
 *   - Pino request-logger
 *   - Globale error-handler (geen stack-leakage in prod)
 *   - Graceful shutdown (SIGTERM/SIGINT)
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { closeDb, db } from './lib/db.js';
import { idempotency } from './middleware/idempotency.js';
import { rateLimit } from './middleware/rate-limit.js';
import { apiRoutes } from './routes/index.js';
import { startScheduler, stopScheduler } from './domain/scheduler/index.js';

const app = new Hono();

const isProd = env.NODE_ENV === 'production';

// ─── Security-headers ───────────────────────────────────────
// Vóór de routes. nosniff + frame-deny + referrer-policy altijd; HSTS alleen
// in productie (anders zou een lokale http-test de cookie/headers verstoren).
app.use(
  '*',
  secureHeaders({
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    contentSecurityPolicy: { frameAncestors: ["'none'"] },
    // HSTS uitsluitend in productie (1 jaar, incl. subdomeinen).
    strictTransportSecurity: isProd
      ? 'max-age=31536000; includeSubDomains'
      : false,
  }),
);

// ─── CORS ────────────────────────────────────────────────────
// Bewust GESPLITST in twee policies:
//
//   A. Publieke, token-gebaseerde paden (/api/storefront/*, /api/feeds/public/*):
//      reflecteer elke origin MAAR `credentials:false`. Deze endpoints gebruiken
//      bearer-/publishable-tokens, geen cookies — een wildcard-origin met
//      credentials zou een onnodig (en door browsers geweigerd) cookie-lek-
//      oppervlak zijn.
//
//   B. Admin (allowlist o.b.v. ADMIN_PUBLIC_URL): `credentials:true` zodat de
//      same-site sessie-cookie meegaat. Alleen expliciet toegestane origins.
//
// Het pad bepaalt welke policy draait; Hono cors() is per-request.
const isPublicTokenPath = (path: string): boolean =>
  path.startsWith('/api/storefront/') || path.startsWith('/api/feeds/public/');

// A — publieke token-paden: reflecteer origin, GEEN credentials.
app.use('/api/storefront/*', cors({
  origin: (origin) => origin ?? '*',
  credentials: false,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Idempotency-Key', 'Authorization'],
}));
app.use('/api/feeds/public/*', cors({
  origin: (origin) => origin ?? '*',
  credentials: false,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Idempotency-Key', 'Authorization'],
}));

// B — al het overige (admin + privé API): allowlist mét credentials.
app.use('*', async (c, next) => {
  // De publieke token-paden zijn hierboven al afgehandeld; sla CORS hier over
  // zodat we niet per ongeluk credentials:true op een wildcard-origin zetten.
  if (isPublicTokenPath(c.req.path)) return next();
  return cors({
    origin: (origin) => {
      if (!origin) return origin;
      const allowList = [env.ADMIN_PUBLIC_URL];
      // In dev ook localhost:7301 toestaan via vite-proxy:
      if (env.NODE_ENV !== 'production') {
        allowList.push('http://localhost:7301', 'http://127.0.0.1:7301');
      }
      return allowList.includes(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Idempotency-Key', 'Authorization'],
  })(c, next);
});

// ─── Request-logger ─────────────────────────────────────────
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms,
    },
    'http',
  );
});

// ─── Rate-limiting ──────────────────────────────────────────
// In-memory sliding-window (per client-IP). UIT in NODE_ENV=test (de limiter
// zelf no-opt dan). Strikt op auth-login (brute-force) + ruimer op de publieke
// storefront-/payments-paden (scraping/abuse).
//
// Login: 10 pogingen / 15 min per IP.
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, max: 10, keyPrefix: 'login' }));
// Publieke storefront-API: 120 req/min per IP.
app.use('/api/storefront/*', rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'storefront' }));
// Payments (incl. Mollie-webhook): 120 req/min per IP.
app.use('/api/payments/*', rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'payments' }));

// ─── Idempotency-key handling op writes ─────────────────────
app.use('/api/*', idempotency);

// ─── Health-endpoints ───────────────────────────────────────
// Liveness: goedkoop, raakt de DB NIET (geschikt voor frequente container-probes).
app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'webshop-crm-api',
    version: '0.1.0',
    env: env.NODE_ENV,
    ts: new Date().toISOString(),
  }),
);

// Readiness: verifieert dat de DB bereikbaar is. 200 bij `select 1`, anders 503.
app.get('/health/ready', async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ ok: true, db: 'ok', ts: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, 'readiness check failed (db unreachable)');
    return c.json({ ok: false, db: 'error', ts: new Date().toISOString() }, 503);
  }
});

// ─── Storage static-serve (lokale image-uploads) ──────────────
// LET OP: pad MOET overeenkomen met env.STORAGE_LOCAL_PATH (default ./storage).
// In V2 (S3) verdwijnt deze handler — files worden dan direct van CDN geserveerd.
// Plaats VOOR app.route('/api', ...) zodat de Hono not-found catch-all
// `/storage/*` niet opvangt.
app.use(
  '/storage/*',
  serveStatic({
    root: './',
    rewriteRequestPath: (path) => path,
  }),
);

// ─── API-routes ─────────────────────────────────────────────
app.route('/api', apiRoutes);

// ─── Globale error-handler ─────────────────────────────────
app.onError((err, c) => {
  logger.error({ err, path: c.req.path }, 'unhandled error');
  const isProd = env.NODE_ENV === 'production';
  return c.json(
    {
      error: 'internal_error',
      message: isProd ? 'Something went wrong' : err.message,
    },
    500,
  );
});

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

// ─── Boot ───────────────────────────────────────────────────
const server = serve(
  {
    fetch: app.fetch,
    port: env.API_PORT,
    hostname: env.API_HOST,
  },
  (info) => {
    logger.info(
      { port: info.port, host: env.API_HOST, env: env.NODE_ENV },
      `webshop-crm API listening on http://${env.API_HOST}:${info.port}`,
    );
    // Start de achtergrond-scheduler PAS nadat de server luistert. Zelf-gated
    // (SCHEDULER_ENABLED / NODE_ENV); no-op wanneer er niets connected is.
    startScheduler();
  },
);

// ─── Graceful shutdown ──────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutdown initiated');
  try {
    stopScheduler();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDb();
    logger.info('shutdown clean');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'shutdown error');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { app };
