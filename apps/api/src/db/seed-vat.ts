/**
 * Seed-uitbreiding — BTW-tarieven (`vat_rates`).
 *
 *   Run direct:   `pnpm --filter @webshop-crm/api exec tsx src/db/seed-vat.ts`
 *   Of via Atlas: `seedVatRates()` aanhaken in de hoofd-seed-flow (seed.ts).
 *
 * Idempotent: gebruikt `onConflictDoNothing` op de UNIQUE(country, tax_class,
 * valid_from)-constraint, dus herhaaldelijk runnen maakt geen duplicates.
 *
 * Dataset (NL + EU-OSS kern voor V1):
 *   NL  21 standard / 9 reduced / 0 zero
 *   DE  19 standard / 7 reduced / 0 zero
 *   FR  20 standard / 5.5 reduced / 0 zero
 *   BE  21 standard / 6 reduced / 0 zero
 *
 * BTW = numeric(5,2) -> we seeden als string ('21.00') zodat de waarde 1-op-1
 * matcht met wat de driver teruggeeft (geen float-drift bij vergelijken).
 */
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { vatRates } from './schema/vat-rates.js';

export interface VatSeedRow {
  country: string; // ISO-2
  taxClass: 'standard' | 'reduced' | 'zero';
  rate: string; // numeric(5,2) als string
  label: string;
}

/** Bron-dataset — uitbreidbaar naar alle 27 EU-landen in Fase 4. */
export const VAT_SEED_ROWS: VatSeedRow[] = [
  // ── Nederland (thuis-land) ───────────────────────────────
  { country: 'NL', taxClass: 'standard', rate: '21.00', label: 'NL hoog tarief' },
  { country: 'NL', taxClass: 'reduced', rate: '9.00', label: 'NL laag tarief' },
  { country: 'NL', taxClass: 'zero', rate: '0.00', label: 'NL nultarief' },
  // ── Duitsland (OSS) ──────────────────────────────────────
  { country: 'DE', taxClass: 'standard', rate: '19.00', label: 'DE Regelsteuersatz' },
  { country: 'DE', taxClass: 'reduced', rate: '7.00', label: 'DE ermäßigter Satz' },
  { country: 'DE', taxClass: 'zero', rate: '0.00', label: 'DE Nullsatz' },
  // ── Frankrijk (OSS) ──────────────────────────────────────
  { country: 'FR', taxClass: 'standard', rate: '20.00', label: 'FR taux normal' },
  { country: 'FR', taxClass: 'reduced', rate: '5.50', label: 'FR taux réduit' },
  { country: 'FR', taxClass: 'zero', rate: '0.00', label: 'FR taux zéro' },
  // ── België (OSS) ─────────────────────────────────────────
  { country: 'BE', taxClass: 'standard', rate: '21.00', label: 'BE standaard tarief' },
  { country: 'BE', taxClass: 'reduced', rate: '6.00', label: 'BE verlaagd tarief' },
  { country: 'BE', taxClass: 'zero', rate: '0.00', label: 'BE nultarief' },
];

/**
 * Idempotente insert van alle VAT-rows. Geeft het aantal feitelijk ingevoegde
 * rijen terug (0 als alles al bestond).
 */
export async function seedVatRates(): Promise<{ inserted: number; total: number }> {
  let inserted = 0;
  for (const row of VAT_SEED_ROWS) {
    const res = await db
      .insert(vatRates)
      .values({
        country: row.country,
        taxClass: row.taxClass,
        rate: row.rate,
        label: row.label,
        // valid_from = CURRENT_DATE via schema-default
      })
      .onConflictDoNothing({
        target: [vatRates.country, vatRates.taxClass, vatRates.validFrom],
      })
      .returning({ id: vatRates.id });
    inserted += res.length;
  }
  logger.info({ inserted, total: VAT_SEED_ROWS.length }, 'vat_rates seeded');
  return { inserted, total: VAT_SEED_ROWS.length };
}

// ─── CLI-entry (alleen als dit bestand direct gerund wordt) ──────────
//
// Detecteer "direct uitgevoerd" zonder import.meta-edge-cases: vergelijk
// het script-pad in argv[1]. Bij import (door seed.ts of een test) draait dit
// blok NIET.
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /seed-vat\.[tj]s$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  seedVatRates()
    .then((r) => {
      logger.info(r, 'seed-vat OK');
    })
    .catch((err) => {
      logger.error({ err }, 'seed-vat failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
