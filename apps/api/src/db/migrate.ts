/**
 * Migrate-runner. Past alle ./drizzle/*.sql migrations toe.
 *
 * Run: `pnpm --filter @webshop-crm/api db:migrate`
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';

const here = fileURLToPath(import.meta.url);
const migrationsFolder = resolve(here, '..', '..', '..', 'drizzle');

async function main() {
  logger.info({ migrationsFolder }, 'Running migrations...');
  await migrate(db, { migrationsFolder });
  logger.info('Migrations OK.');
}

main()
  .catch((err) => {
    logger.error({ err }, 'Migration failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
