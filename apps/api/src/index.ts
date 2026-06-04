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
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { closeDb } from './lib/db.js';
import { idempotency } from './middleware/idempotency.js';
import { apiRoutes } from './routes/index.js';
import { startScheduler, stopScheduler } from './domain/scheduler/index.js';

const app = new Hono();

// ─── CORS: admin (en later storefronts) ─────────────────────
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      if (!origin) return origin;
      // Publieke storefront-API: reflecteer elke origin (Wave-3 storefronts
      // draaien op hun eigen domeinen/poorten). Geen cookies nodig daar.
      if (c.req.path.startsWith('/api/storefront/')) return origin;
      if (c.req.path.startsWith('/api/feeds/public/')) return origin;
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
  }),
);

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

// ─── Idempotency-key handling op writes ─────────────────────
app.use('/api/*', idempotency);

// ─── Health-endpoint ────────────────────────────────────────
app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'webshop-crm-api',
    version: '0.1.0',
    env: env.NODE_ENV,
    ts: new Date().toISOString(),
  }),
);

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
