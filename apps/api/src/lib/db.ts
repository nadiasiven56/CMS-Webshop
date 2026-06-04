/**
 * Drizzle + postgres-js client.
 *
 * Connection-pool met sane defaults voor lokale dev. Productie-tuning komt
 * in Fase 5/V2 (zie ARCHITECTURE.md — deployment-topologie).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from './env.js';
import * as schema from '../db/schema/index.js';

// postgres-js client. `prepare:false` is veiliger met PgBouncer (irrelevant lokaal,
// maar voorkomt verrassingen later). `max:10` voldoende voor dev.
const queryClient = postgres(env.DATABASE_URL, {
  max: env.NODE_ENV === 'production' ? 20 : 10,
  idle_timeout: 30,
  prepare: false,
});

export const db = drizzle(queryClient, {
  schema,
  logger: env.NODE_ENV === 'development' && env.LOG_LEVEL === 'debug',
});

export type DB = typeof db;
export { schema };

/**
 * Graceful shutdown helper. Aangeroepen door /index.ts SIGTERM-handler
 * en door test-cleanup.
 */
export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
