/**
 * Typed environment loader.
 *
 * Wordt zo vroeg mogelijk geimporteerd zodat fouten meteen aan boot zichtbaar zijn.
 * Leest .env uit project-root (../../.env vanuit apps/api/src/lib/).
 */
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Resolve project-root (.env staat in monorepo-root)
const here = fileURLToPath(import.meta.url);
const projectRoot = resolve(here, '..', '..', '..', '..', '..');
dotenvConfig({ path: resolve(projectRoot, '.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Database
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),

  // Redis (optioneel in Fase 1, vereist vanaf Fase 2)
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // API server
  API_PORT: z.coerce.number().int().positive().default(7300),
  API_HOST: z.string().default('127.0.0.1'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:7300'),

  // Admin
  ADMIN_PUBLIC_URL: z.string().url().default('http://localhost:7301'),

  // Round 3 — public base-URL voor feed-links + publieke feed/analytics-URLs.
  // Optioneel; fallback = API_PUBLIC_URL (feeds-module leest los uit process.env).
  PUBLIC_BASE_URL: z.string().url().optional(),

  // Auth
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET moet 32+ chars zijn'),
  CHANNEL_SECRET_KEY: z.string().min(32, 'CHANNEL_SECRET_KEY moet 32+ chars zijn'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Seed
  SEED_ADMIN_EMAIL: z.string().email().default('admin@webshop-crm.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('change-me-please'),

  // Storage
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),

  // Logging
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // Feature flags
  ENABLE_DEV_ROUTES: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),

  // Scheduler (auto channel-sync). Gated zodat test-/migratie-runs niets starten.
  // SCHEDULER_ENABLED optioneel: undefined → default (aan, behalve NODE_ENV=test).
  SCHEDULER_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  // Interval tussen sync-runs in ms. Default 15 min (900000).
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(900000),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment variables:\n${issues}\n\n` +
        `Check .env (kopieer .env.example als nodig).`,
    );
  }
  return parsed.data;
}

export function getEnv(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

export const env = getEnv();
