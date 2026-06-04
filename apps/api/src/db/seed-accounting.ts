/**
 * Seed-uitbreiding — boekhoud-koppelingen (`accounting_connections`).
 *
 *   Run direct:   `pnpm --filter @webshop-crm/api exec tsx src/db/seed-accounting.ts`
 *   Of via Atlas: `seedAccounting()` aanhaken in de hoofd-seed-flow (seed.ts).
 *
 * Idempotent: `accounting_connections` heeft GEEN unique-constraint op
 * `provider` (de operator mag desgewenst meerdere administraties van dezelfde
 * provider koppelen), dus we checken per provider op bestaan en slaan over als
 * die er al is — zelfde patroon als seedChannels().
 *
 * Wat wordt geseed (Fase 4 — boekhouding):
 *   - moneybird    : 'Moneybird'      status disconnected (placeholder)
 *   - exact        : 'Exact Online'   status disconnected (placeholder)
 *   - eboekhouden  : 'e-Boekhouden'   status disconnected (placeholder)
 *
 * Credentials blijven leeg; die worden later via channel-crypto encrypted
 * opgeslagen wanneer de operator een koppeling verbindt.
 */
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { accountingConnections } from './schema/accounting.js';

export interface AccountingSeedRow {
  provider: string; // moneybird | exact | eboekhouden
  name: string;
  status: 'connected' | 'disconnected';
}

/** Bron-dataset — uitbreidbaar met extra boekhoudpakketten later. */
export const ACCOUNTING_SEED_ROWS: AccountingSeedRow[] = [
  { provider: 'moneybird', name: 'Moneybird', status: 'disconnected' },
  { provider: 'exact', name: 'Exact Online', status: 'disconnected' },
  { provider: 'eboekhouden', name: 'e-Boekhouden', status: 'disconnected' },
];

/**
 * Idempotente insert van alle koppeling-rows. Geeft het aantal feitelijk
 * ingevoegde rijen terug (0 als alles al bestond).
 */
export async function seedAccounting(): Promise<{ inserted: number; total: number }> {
  let inserted = 0;
  for (const row of ACCOUNTING_SEED_ROWS) {
    const existing = await db
      .select({ id: accountingConnections.id })
      .from(accountingConnections)
      .where(eq(accountingConnections.provider, row.provider))
      .limit(1);
    if (existing.length > 0) {
      logger.info({ provider: row.provider }, 'accounting connection already exists, skipping');
      continue;
    }
    await db.insert(accountingConnections).values({
      provider: row.provider,
      name: row.name,
      status: row.status,
      // credentials/config blijven op schema-default (null / {}).
    });
    inserted += 1;
    logger.info({ provider: row.provider }, 'accounting connection created');
  }
  logger.info(
    { inserted, total: ACCOUNTING_SEED_ROWS.length },
    'accounting connections seeded',
  );
  return { inserted, total: ACCOUNTING_SEED_ROWS.length };
}

// ─── CLI-entry (alleen als dit bestand direct gerund wordt) ──────────
//
// Detecteer "direct uitgevoerd" via het script-pad in argv[1]. Bij import (door
// seed.ts of een test) draait dit blok NIET.
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /seed-accounting\.[tj]s$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  seedAccounting()
    .then((r) => {
      logger.info(r, 'seed-accounting OK');
    })
    .catch((err) => {
      logger.error({ err }, 'seed-accounting failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
