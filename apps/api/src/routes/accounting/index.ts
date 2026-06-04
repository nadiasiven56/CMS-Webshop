/**
 * Accounting-router — `/api/accounting/*`.
 *
 * Boekhoud-koppeling-beheer: Moneybird / Exact Online / e-Boekhouden, allemaal
 * CONNECT-READY. Naast de bestaande UBL-export pusht deze module facturen/orders
 * naar een extern boekhoudpakket via de officiële API's. De route-laag praat
 * NOOIT direct met een boekhoud-SDK — altijd via een {@link AccountingAdapter}
 * uit de adapter-registry.
 *
 * Endpoints (alle achter `requireAuth`):
 *   GET    /api/accounting/connections                       — list (masked creds + counts)
 *   POST   /api/accounting/connections                       — create {provider,name,config}
 *   GET    /api/accounting/connections/:id                   — detail (masked + counts)
 *   PATCH  /api/accounting/connections/:id                   — partial update (name/config/status)
 *   DELETE /api/accounting/connections/:id                   — delete (cascade sync-log)
 *   PUT    /api/accounting/connections/:id/credentials       — encrypt → store credentials
 *   POST   /api/accounting/connections/:id/test-connection   — decrypt in-memory → verify → persist status
 *   POST   /api/accounting/connections/:id/sync              — push invoices/orders (guarded, idempotent)
 *   GET    /api/accounting/connections/:id/sync-log          — append-log paginated
 *
 * KRITISCH: credentials worden encrypted opgeslagen (channel-crypto) en NOOIT
 * raw teruggegeven (alleen masked presence-map via _serialize). Niets vuurt live
 * zonder credentials — de adapters guarden elke netwerk-call achter
 * requireCreds() en surfacen een typed accounting_not_connected → 409.
 *
 * Facturen/orders worden READ-ONLY uit de bestaande finance-tabellen gelezen
 * (`invoices` / `orders` + `order_items`); deze module muteert die NOOIT.
 *
 * Wired in routes/index.ts door de finalizer — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { encryptCredentials } from '../../lib/channel-crypto.js';
import {
  accountingConnections,
  accountingSyncLog,
  type AccountingConnection,
} from '../../db/schema/accounting.js';
import { invoices, type Invoice } from '../../db/schema/invoices.js';
import { orders, type Order } from '../../db/schema/orders.js';
import { orderItems } from '../../db/schema/order-items.js';
import { getAccountingAdapter } from './adapters/index.js';
import {
  isAccountingNotConnectedError,
  type AccountingInvoiceInput,
  type AccountingInvoiceLine,
  type AccountingSalesOrderInput,
} from './adapters/types.js';
import {
  ConnectionCreateSchema,
  ConnectionListQuerySchema,
  ConnectionPatchSchema,
  CREDENTIALS_SCHEMA_BY_PROVIDER,
  SyncLogQuerySchema,
  SyncRequestSchema,
} from './_schemas.js';
import {
  toConnectionDto,
  toConnectionDetailDto,
  toSyncLogDto,
} from './_serialize.js';

export const accountingRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles — admin-module.
accountingRoutes.use('*', requireAuth);

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

/** Sync-log counts per connection — volgt het channels count-patroon. */
async function countSyncLog(
  connectionId: string,
): Promise<{ syncLog: number; synced: number; errors: number }> {
  const rows = await db
    .select({ status: accountingSyncLog.status })
    .from(accountingSyncLog)
    .where(eq(accountingSyncLog.connectionId, connectionId));
  let synced = 0;
  let errors = 0;
  for (const r of rows) {
    if (r.status === 'synced') synced += 1;
    else if (r.status === 'error') errors += 1;
  }
  return { syncLog: rows.length, synced, errors };
}

// ─── GET /connections — list ─────────────────────────────────

accountingRoutes.get('/connections', async (c) => {
  const parsed = ConnectionListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { provider, status, limit, offset } = parsed.data;

  const conditions = [];
  if (provider) conditions.push(eq(accountingConnections.provider, provider));
  if (status) conditions.push(eq(accountingConnections.status, status));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(accountingConnections)
    .orderBy(asc(accountingConnections.name))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: accountingConnections.id }).from(accountingConnections).where(whereExpr)
    : db.select({ id: accountingConnections.id }).from(accountingConnections));

  const items = await Promise.all(
    rows.map(async (conn) => {
      const counts = await countSyncLog(conn.id);
      return toConnectionDetailDto(conn, counts);
    }),
  );

  return c.json({ items, total: allIds.length, limit, offset });
});

// ─── POST /connections — create ──────────────────────────────

accountingRoutes.post('/connections', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ConnectionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const conn = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .insert(accountingConnections)
      .values({
        provider: input.provider,
        name: input.name,
        status: 'disconnected',
        config: input.config ?? {},
      })
      .returning();
    if (!row) throw new Error('accounting connection insert returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'accounting_connection',
      entityId: row.id,
      before: null,
      after: { id: row.id, provider: row.provider, name: row.name, status: row.status },
      ip: ip(c),
    });
    return row;
  });

  logger.info(
    { connectionId: conn.id, provider: conn.provider, actor: user.id },
    'accounting connection created',
  );
  return c.json(
    { connection: toConnectionDetailDto(conn, { syncLog: 0, synced: 0, errors: 0 }) },
    201,
  );
});

// ─── GET /connections/:id — detail ───────────────────────────

accountingRoutes.get('/connections/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [conn] = await db
    .select()
    .from(accountingConnections)
    .where(eq(accountingConnections.id, id))
    .limit(1);
  if (!conn) return c.json({ error: 'not_found' }, 404);

  const counts = await countSyncLog(id);
  return c.json({ connection: toConnectionDetailDto(conn, counts) });
});

// ─── PATCH /connections/:id — update ─────────────────────────

accountingRoutes.patch('/connections/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ConnectionPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;

  const [existing] = await db
    .select()
    .from(accountingConnections)
    .where(eq(accountingConnections.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) setValues.name = patch.name;
  if (patch.config !== undefined) setValues.config = patch.config;
  if (patch.status !== undefined) setValues.status = patch.status;

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(accountingConnections)
      .set(setValues)
      .where(eq(accountingConnections.id, id))
      .returning();
    if (!row) throw new Error('accounting connection update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'accounting_connection',
      entityId: row.id,
      before: { name: existing.name, status: existing.status, config: existing.config },
      after: { name: row.name, status: row.status, config: row.config },
      ip: ip(c),
    });
    return row;
  });

  const counts = await countSyncLog(id);
  logger.info({ connectionId: id, actor: user.id }, 'accounting connection updated');
  return c.json({ connection: toConnectionDetailDto(updated, counts) });
});

// ─── DELETE /connections/:id — cascade ───────────────────────

accountingRoutes.delete('/connections/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [existing] = await db
    .select()
    .from(accountingConnections)
    .where(eq(accountingConnections.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  await runInTransactionWithAudit(async (tx, audit) => {
    // accounting_sync_log cascadet via FK onDelete:'cascade'.
    await tx.delete(accountingConnections).where(eq(accountingConnections.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'accounting_connection',
      entityId: id,
      before: { id: existing.id, provider: existing.provider, name: existing.name },
      after: null,
      ip: ip(c),
    });
  });

  logger.info({ connectionId: id, actor: user.id }, 'accounting connection deleted');
  return c.json({ ok: true, id });
});

// ─── PUT /connections/:id/credentials — encrypt + store ──────

accountingRoutes.put('/connections/:id/credentials', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [existing] = await db
    .select()
    .from(accountingConnections)
    .where(eq(accountingConnections.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const schema =
    CREDENTIALS_SCHEMA_BY_PROVIDER[
      existing.provider as keyof typeof CREDENTIALS_SCHEMA_BY_PROVIDER
    ];
  if (schema === undefined) {
    return c.json({ error: 'unsupported_provider', provider: existing.provider }, 422);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }

  const encrypted = encryptCredentials(parsed.data as Record<string, unknown>);

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(accountingConnections)
      .set({ credentials: encrypted, updatedAt: new Date() })
      .where(eq(accountingConnections.id, id))
      .returning();
    if (!row) throw new Error('accounting credentials update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'accounting_connection',
      entityId: row.id,
      // NOOIT de raw creds in audit — alleen dat ze gezet zijn.
      before: { hadCredentials: existing.credentials != null },
      after: { hasCredentials: true, fields: Object.keys(parsed.data as object) },
      ip: ip(c),
    });
    return row;
  });

  const counts = await countSyncLog(id);
  logger.info({ connectionId: id, actor: user.id }, 'accounting credentials stored');
  return c.json({ connection: toConnectionDetailDto(updated, counts) });
});

// ─── POST /connections/:id/test-connection ───────────────────

accountingRoutes.post('/connections/:id/test-connection', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [conn] = await db
    .select()
    .from(accountingConnections)
    .where(eq(accountingConnections.id, id))
    .limit(1);
  if (!conn) return c.json({ error: 'not_found' }, 404);

  const adapter = getAccountingAdapter(conn.provider);
  if (!adapter) {
    return c.json({ error: 'unsupported_provider', provider: conn.provider }, 422);
  }

  // verifyConnection decrypteert in-memory (binnen de adapter) en throwt NOOIT.
  const verify = await adapter.verifyConnection(conn);
  const nextStatus = verify.ok ? 'connected' : 'error';

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(accountingConnections)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(accountingConnections.id, id))
      .returning();
    if (!row) throw new Error('accounting status update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'accounting_connection',
      entityId: row.id,
      before: { status: conn.status },
      after: { status: row.status, verifyDetail: verify.detail },
      ip: ip(c),
    });
    return row;
  });

  const counts = await countSyncLog(id);
  return c.json({
    ok: verify.ok,
    detail: verify.detail,
    connection: toConnectionDetailDto(updated, counts),
  });
});

// ─── POST /connections/:id/sync ──────────────────────────────
//
// Guarded + idempotent. Als de connection niet 'connected' is → 409
// accounting_not_connected (niets vuurt zonder creds). Anders itereren we de
// relevante finance-facturen/orders in de periode, roepen we de adapter
// (push-invoice/push-sales-order) guarded aan, schrijven we een
// accounting_sync_log-rij per entiteit, en updaten we lastSyncAt. Idempotent:
// entiteiten die al een sync-log-rij met status 'synced' hebben, slaan we over.

accountingRoutes.post('/connections/:id/sync', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = SyncRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { scope, from, to } = parsed.data;

  const [conn] = await db
    .select()
    .from(accountingConnections)
    .where(eq(accountingConnections.id, id))
    .limit(1);
  if (!conn) return c.json({ error: 'not_found' }, 404);

  const adapter = getAccountingAdapter(conn.provider);
  if (!adapter) {
    return c.json({ error: 'unsupported_provider', provider: conn.provider }, 422);
  }

  // Niet-connected → 409 vóór we ook maar één entiteit ophalen.
  if (conn.status !== 'connected') {
    return c.json(
      {
        error: 'accounting_not_connected',
        message: `${conn.provider} is not connected — enter credentials and test-connection first`,
      },
      409,
    );
  }

  // Reeds-gesynchroniseerde entiteit-ids (idempotentie).
  const alreadySynced = await loadSyncedEntityIds(id);

  const errors: string[] = [];
  let pushed = 0;
  let skipped = 0;

  if (scope === 'invoices') {
    const rows = await loadInvoicesInRange(from, to);
    for (const inv of rows) {
      if (alreadySynced.has(inv.id)) {
        skipped += 1;
        continue;
      }
      try {
        const input = invoiceToAccountingInput(inv);
        const result = await adapter.pushInvoice(conn, input);
        await writeSyncLog(id, {
          entityType: 'invoice',
          entityId: inv.id,
          externalId: result.externalId,
          status: 'synced',
          message: null,
          raw: result.raw,
        });
        pushed += 1;
      } catch (err) {
        if (isAccountingNotConnectedError(err)) {
          return c.json(
            {
              error: 'accounting_not_connected',
              message: err instanceof Error ? err.message : 'not connected',
            },
            409,
          );
        }
        const message = err instanceof Error ? err.message : 'push failed';
        await writeSyncLog(id, {
          entityType: 'invoice',
          entityId: inv.id,
          externalId: null,
          status: 'error',
          message,
          raw: null,
        });
        errors.push(`invoice ${inv.invoiceNumber}: ${message}`);
      }
    }
  } else {
    // scope === 'orders'
    if (!adapter.pushSalesOrder) {
      return c.json(
        { error: 'orders_not_supported', provider: conn.provider },
        422,
      );
    }
    const rows = await loadOrdersInRange(from, to);
    for (const order of rows) {
      if (alreadySynced.has(order.id)) {
        skipped += 1;
        continue;
      }
      try {
        const input = await orderToAccountingInput(order);
        const result = await adapter.pushSalesOrder(conn, input);
        await writeSyncLog(id, {
          entityType: 'order',
          entityId: order.id,
          externalId: result.externalId,
          status: 'synced',
          message: null,
          raw: result.raw,
        });
        pushed += 1;
      } catch (err) {
        if (isAccountingNotConnectedError(err)) {
          return c.json(
            {
              error: 'accounting_not_connected',
              message: err instanceof Error ? err.message : 'not connected',
            },
            409,
          );
        }
        const message = err instanceof Error ? err.message : 'push failed';
        await writeSyncLog(id, {
          entityType: 'order',
          entityId: order.id,
          externalId: null,
          status: 'error',
          message,
          raw: null,
        });
        errors.push(`order ${order.orderNumber}: ${message}`);
      }
    }
  }

  // lastSyncAt zetten + audit.
  await runInTransactionWithAudit(async (tx, audit) => {
    await tx
      .update(accountingConnections)
      .set({ lastSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(accountingConnections.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'sync',
      entityType: 'accounting_connection',
      entityId: id,
      after: { scope, pushed, skipped, errors: errors.length },
      ip: ip(c),
    });
  });

  logger.info(
    { connectionId: id, scope, pushed, skipped, errors: errors.length, actor: user.id },
    'accounting synced',
  );
  return c.json({ scope, pushed, skipped, errors });
});

// ─── GET /connections/:id/sync-log ───────────────────────────

accountingRoutes.get('/connections/:id/sync-log', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const parsed = SyncLogQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { status, entityType, limit, offset } = parsed.data;

  const [conn] = await db
    .select({ id: accountingConnections.id })
    .from(accountingConnections)
    .where(eq(accountingConnections.id, id))
    .limit(1);
  if (!conn) return c.json({ error: 'connection_not_found' }, 404);

  const conditions = [eq(accountingSyncLog.connectionId, id)];
  if (status) conditions.push(eq(accountingSyncLog.status, status));
  if (entityType) conditions.push(eq(accountingSyncLog.entityType, entityType));
  const whereExpr = and(...conditions);

  const rows = await db
    .select()
    .from(accountingSyncLog)
    .where(whereExpr)
    .orderBy(desc(accountingSyncLog.createdAt))
    .limit(limit)
    .offset(offset);

  const allIds = await db
    .select({ id: accountingSyncLog.id })
    .from(accountingSyncLog)
    .where(whereExpr);

  return c.json({
    connectionId: id,
    items: rows.map(toSyncLogDto),
    total: allIds.length,
    limit,
    offset,
  });
});

// ─── helpers (read-only finance reads + sync-log writes) ─────

/**
 * Set van entity-ids die al succesvol gesynct zijn voor deze connection (status
 * 'synced'). Gebruikt om de sync idempotent te houden.
 */
async function loadSyncedEntityIds(connectionId: string): Promise<Set<string>> {
  const rows = await db
    .select({ entityId: accountingSyncLog.entityId })
    .from(accountingSyncLog)
    .where(
      and(
        eq(accountingSyncLog.connectionId, connectionId),
        eq(accountingSyncLog.status, 'synced'),
      ),
    );
  const set = new Set<string>();
  for (const r of rows) if (r.entityId) set.add(r.entityId);
  return set;
}

/** READ-ONLY: issued sales/credit invoices in [from, to] (op issued_at). */
async function loadInvoicesInRange(
  from: string | undefined,
  to: string | undefined,
): Promise<Invoice[]> {
  const conds = [];
  if (from) conds.push(gte(invoices.issuedAt, new Date(`${from}T00:00:00.000Z`)));
  if (to) conds.push(lte(invoices.issuedAt, new Date(`${to}T23:59:59.999Z`)));
  const where = conds.length > 0 ? and(...conds) : undefined;
  return db
    .select()
    .from(invoices)
    .where(where)
    .orderBy(asc(invoices.issuedAt));
}

/** READ-ONLY: orders in [from, to] (op created_at). */
async function loadOrdersInRange(
  from: string | undefined,
  to: string | undefined,
): Promise<Order[]> {
  const conds = [];
  if (from) conds.push(gte(orders.createdAt, new Date(`${from}T00:00:00.000Z`)));
  if (to) conds.push(lte(orders.createdAt, new Date(`${to}T23:59:59.999Z`)));
  const where = conds.length > 0 ? and(...conds) : undefined;
  return db
    .select()
    .from(orders)
    .where(where)
    .orderBy(asc(orders.createdAt));
}

/** Map een finance `invoices`-row naar de genormaliseerde adapter-input. */
function invoiceToAccountingInput(inv: Invoice): AccountingInvoiceInput {
  const rawLines = Array.isArray(inv.lines)
    ? (inv.lines as Array<Record<string, unknown>>)
    : [];
  const lines: AccountingInvoiceLine[] = rawLines.map((l, idx) => ({
    description:
      typeof l.title === 'string'
        ? l.title
        : typeof l.sku === 'string'
          ? l.sku
          : `Regel ${idx + 1}`,
    quantity: Number(l.quantity ?? 1) || 1,
    unitPriceString: l.unitPrice != null ? String(l.unitPrice) : '0',
    vatRateString: l.taxRate != null ? String(l.taxRate) : '21',
  }));
  return {
    number: inv.invoiceNumber,
    date: inv.issuedAt.toISOString().slice(0, 10),
    currency: 'EUR',
    customer: {
      name: inv.customer?.name ?? inv.customer?.company ?? 'Klant',
      email: inv.customer?.email ?? null,
      address: formatAddress(inv.customer?.address ?? null),
    },
    lines,
    totals: {
      subtotalString: inv.subtotal ?? '0',
      vatTotalString: inv.vatTotal ?? '0',
      totalString: inv.total ?? '0',
    },
  };
}

/** Map een `orders`-row (+ order_items) naar de genormaliseerde order-input. */
async function orderToAccountingInput(
  order: Order,
): Promise<AccountingSalesOrderInput> {
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  const lines: AccountingInvoiceLine[] = items.map((it, idx) => ({
    description: it.title ?? it.sku ?? `Regel ${idx + 1}`,
    quantity: it.quantity,
    unitPriceString: it.unitPrice != null ? String(it.unitPrice) : '0',
    vatRateString: String(it.taxRate),
  }));
  return {
    number: order.orderNumber,
    date: (order.placedAt ?? order.createdAt).toISOString().slice(0, 10),
    currency: order.currency,
    customer: {
      name: order.billingAddress?.name ?? order.billingAddress?.company ?? order.email ?? 'Klant',
      email: order.email ?? null,
      address: formatAddress(order.billingAddress ?? null),
    },
    lines,
    totals: {
      subtotalString: order.subtotal ?? '0',
      vatTotalString: order.taxTotal,
      totalString: order.grandTotal ?? '0',
    },
  };
}

/** Plat single-line adres-snapshot uit een address-object of null. */
function formatAddress(
  addr:
    | {
        line1?: string;
        line2?: string;
        postcode?: string;
        city?: string;
        country?: string;
      }
    | null
    | undefined,
): string | null {
  if (!addr) return null;
  const parts = [
    [addr.line1, addr.line2].filter(Boolean).join(' '),
    [addr.postcode, addr.city].filter(Boolean).join(' '),
    addr.country,
  ].filter((p) => p && p.length > 0);
  const joined = parts.join(', ');
  return joined.length > 0 ? joined : null;
}

/** Append-only: schrijf één accounting_sync_log-rij. */
async function writeSyncLog(
  connectionId: string,
  entry: {
    entityType: 'invoice' | 'order' | 'ledger_batch';
    entityId: string | null;
    externalId: string | null;
    status: 'pending' | 'synced' | 'error';
    message: string | null;
    raw: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.insert(accountingSyncLog).values({
    connectionId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    externalId: entry.externalId,
    status: entry.status,
    message: entry.message,
    raw: entry.raw,
  });
}
