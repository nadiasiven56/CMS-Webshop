/**
 * Audit-log helper voor product-mutaties.
 *
 * Schrijft 1 row in `audit_log` per create/update/delete-actie. Wordt
 * binnen dezelfde transactie als de mutation aangeroepen zodat een
 * crash de audit-row meeneemt.
 */
import { auditLog } from '../../db/schema/audit-log.js';

export type ProductAuditAction = 'create' | 'update' | 'delete';

export interface ProductAuditInput {
  action: ProductAuditAction;
  entityType: 'product' | 'variant';
  entityId: string;
  actorId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Drizzle-client shape — accepteert zowel `db` als een tx-handle.
 * Bewust loose getypeerd om Drizzle's interne PgTransaction-generic te vermijden.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AuditClient = any;

export async function writeProductAudit(
  client: AuditClient,
  input: ProductAuditInput,
): Promise<void> {
  await client.insert(auditLog).values({
    actorType: 'user',
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
    ip: input.ip ?? null,
  });
}
