/**
 * Wrapper rond Drizzle's `db.transaction(...)` die naast de werk-callback ook
 * automatisch een `audit_log`-row schrijft.
 *
 * Doel: stock-agent (en straks orders-agent) hoeft niet bij elke write zelf
 * `auditLog.insert(...)` te bouwen — geef gewoon `actor`, `action`,
 * `entityType`, `entityId`, `before`, `after` en de helper schrijft die rij
 * binnen dezelfde transactie.
 *
 * Conventie:
 *   - `before`/`after` zijn snapshots als JSON-serializable plain object.
 *   - `actor` is meestal `{ type: 'user', id: <uuid> }`. `type` accepteert
 *     'user' | 'job' | 'webhook' | 'api' (zie `audit_log.actor_type`).
 *   - Bij job/webhook is `id` optioneel.
 */
import { db } from '../../lib/db.js';
import { auditLog } from '../../db/schema/audit-log.js';
import type { DbOrTx } from './available-recompute.js';

export interface AuditActor {
  type: 'user' | 'job' | 'webhook' | 'api';
  id?: string | null;
}

export interface AuditEntry {
  actor: AuditActor;
  action: string; // 'create' | 'update' | 'delete' | 'adjust' | ...
  entityType: string; // 'inventory_movement' | 'inventory_level' | 'order' | ...
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Schrijf een audit-row binnen een gegeven tx (of db buiten transactie).
 * Helper-laag, zodat callers niet zelf de schema-shape kennen.
 */
export async function writeAudit(tx: DbOrTx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorType: entry.actor.type,
    actorId: entry.actor.id ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: (entry.before ?? null) as never,
    after: (entry.after ?? null) as never,
    ip: entry.ip ?? null,
  });
}

/**
 * Run een transactionele werk-callback en schrijf 1 audit-row aan het einde.
 *
 * De callback krijgt het `tx`-handle EN een `audit`-builder die je MAG
 * aanroepen om de audit-payload te zetten. Wordt audit niet gezet, dan
 * wordt geen rij geschreven (skip-pattern voor read-only werk).
 *
 * Voorbeeld:
 * ```ts
 * await runInTransactionWithAudit(async (tx, audit) => {
 *   const newLevel = await applyDeltaAndRecompute(tx, { ... });
 *   const [movement] = await tx.insert(inventoryMovements).values({...}).returning();
 *   audit.set({
 *     actor: { type: 'user', id: userId },
 *     action: 'adjust',
 *     entityType: 'inventory_movement',
 *     entityId: movement.id,
 *     after: movement,
 *   });
 *   return { newLevel, movement };
 * });
 * ```
 */
export async function runInTransactionWithAudit<T>(
  work: (tx: DbOrTx, audit: AuditBuilder) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const builder = new AuditBuilder();
    const result = await work(tx as unknown as DbOrTx, builder);
    if (builder.entry) {
      await writeAudit(tx as unknown as DbOrTx, builder.entry);
    }
    return result;
  });
}

export class AuditBuilder {
  entry: AuditEntry | undefined;
  set(entry: AuditEntry): void {
    this.entry = entry;
  }
}
