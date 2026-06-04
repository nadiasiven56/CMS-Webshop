/**
 * Audit-log read-API — `/api/audit/*` (read-only, achter requireAuth).
 *
 *   GET /api/audit        — gefilterde lijst (entity_type, action, actor_id,
 *                           entity_id, from, to, limit, offset), nieuwste eerst.
 *   GET /api/audit/:id    — één entry.
 *
 * De `audit_log`-tabel wordt door alle domein-flows (orders/returns/channels/…)
 * via `runInTransactionWithAudit` gevuld. Deze endpoint serveert die rijen als
 * een schone DTO (actor, action, entityType, entityId, before/after-summary, ip,
 * createdAt-iso). Schrijven kan NIET via deze route — audit is append-only en
 * uitsluitend door de domein-transacties geschreven.
 */
import { Hono } from 'hono';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { auditLog, type AuditLog } from '../../db/schema/audit-log.js';
import { isUuid } from '../products/_validate.js';

export const auditRoutes = new Hono<{ Variables: AuthVariables }>();

auditRoutes.use('*', requireAuth);

const ListQuerySchema = z.object({
  entityType: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  actorId: z.string().trim().min(1).optional(),
  entityId: z.string().uuid().optional(),
  // ISO-datums (inclusief). Soepel: alleen geldige datums tellen.
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Compacte samenvatting van een (potentieel groot) before/after jsonb-object. */
function summarizeState(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value !== 'object') return { value };
  // Houd het DTO klein: top-level keys, primitives behouden, geneste objecten
  // worden tot hun type samengevat zodat de lijst-response niet ontploft.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = `[array:${v.length}]`;
    } else {
      out[k] = '[object]';
    }
  }
  return out;
}

export interface AuditEntryDto {
  id: string;
  actor: { type: string; id: string | null };
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

function toAuditDto(row: AuditLog): AuditEntryDto {
  return {
    id: row.id,
    actor: { type: row.actorType, id: row.actorId },
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: summarizeState(row.before),
    after: summarizeState(row.after),
    ip: row.ip,
    createdAt: row.ts.toISOString(),
  };
}

// ─── GET /api/audit — gefilterde lijst ───────────────────────

auditRoutes.get('/', async (c) => {
  const parsed = ListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { entityType, action, actorId, entityId, from, to, limit, offset } = parsed.data;

  const conditions: SQL[] = [];
  if (entityType) conditions.push(eq(auditLog.entityType, entityType));
  if (action) conditions.push(eq(auditLog.action, action));
  if (actorId) conditions.push(eq(auditLog.actorId, actorId));
  if (entityId) conditions.push(eq(auditLog.entityId, entityId));
  if (from) conditions.push(gte(auditLog.ts, from));
  if (to) conditions.push(lte(auditLog.ts, to));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.ts))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  return c.json({ items: rows.map(toAuditDto), limit, offset });
});

// ─── GET /api/audit/:id — één entry ──────────────────────────

auditRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id)).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);

  return c.json({ entry: toAuditDto(row) });
});
