import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: text('actor_type').notNull(), // 'user' | 'job' | 'webhook' | 'api'
    actorId: text('actor_id'),
    action: text('action').notNull(), // 'create' | 'update' | 'delete' | 'ship' | 'cancel'
    entityType: text('entity_type').notNull(), // 'order' | 'product' | 'inventory_movement'
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index('audit_log_entity_idx').on(t.entityType, t.entityId, t.ts),
  }),
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
