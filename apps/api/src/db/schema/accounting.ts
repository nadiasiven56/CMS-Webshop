import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Boekhoud-koppeling (Moneybird / Exact Online / e-Boekhouden) — CONNECT-READY.
 *
 * Naast de bestaande UBL-export (`finance/exports/ubl`) pusht deze module
 * facturen/verkopen + grootboek naar een extern boekhoudpakket via de officiële
 * API's. `credentials` wordt encrypted opgeslagen (channel-crypto, `{ enc }`),
 * exact zoals `channels.credentials`. Niets vuurt live zonder credentials — de
 * adapters guarden elke netwerk-call achter een `requireCreds()`-check.
 *
 * `provider` is functioneel uniek per koppeling; we seeden er één per provider
 * (moneybird/exact/eboekhouden) als 'disconnected'. (We zetten geen DB-UNIQUE
 * constraint zodat de operator desgewenst meerdere administraties van dezelfde
 * provider kan koppelen — idempotentie van de seed gebeurt in code, net als bij
 * seed-channels.)
 */
export const accountingConnections = pgTable('accounting_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(), // moneybird | exact | eboekhouden
  name: text('name').notNull(),
  status: text('status').notNull().default('disconnected'),
  // disconnected | connected | error
  credentials: jsonb('credentials').$type<Record<string, unknown> | null>(),
  // Vrij config-blob: administrationId / division / ledgerMappings etc.
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AccountingConnection = typeof accountingConnections.$inferSelect;
export type NewAccountingConnection = typeof accountingConnections.$inferInsert;

/**
 * Sync-log (append-only). Eén rij per gesynchroniseerde entiteit (factuur /
 * order / grootboek-batch). Idempotentie van de sync leunt hierop: bestaat er
 * al een rij met status 'synced' voor (connectionId, entityType, entityId), dan
 * slaan we die entiteit over. Geen `updated_at` — dit is een log, niet een
 * muteerbare rij.
 */
export const accountingSyncLog = pgTable(
  'accounting_sync_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => accountingConnections.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(), // invoice | order | ledger_batch
    entityId: uuid('entity_id'),
    externalId: text('external_id'),
    status: text('status').notNull(), // pending | synced | error
    message: text('message'),
    raw: jsonb('raw').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    connectionIdx: index('accounting_sync_log_connection_idx').on(t.connectionId),
  }),
);

export type AccountingSyncLog = typeof accountingSyncLog.$inferSelect;
export type NewAccountingSyncLog = typeof accountingSyncLog.$inferInsert;
