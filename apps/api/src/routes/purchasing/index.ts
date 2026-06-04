/**
 * Purchasing-router — `/api/purchasing/*`.
 *
 * Endpoints (alle achter `requireAuth`):
 *   Suppliers
 *     GET    /suppliers              — list (search/active/paginate)
 *     POST   /suppliers              — create
 *     GET    /suppliers/:id          — detail
 *     PATCH  /suppliers/:id          — update
 *     DELETE /suppliers/:id          — soft-delete (active=false) of hard-delete als ?hard=true
 *
 *   Purchase-orders
 *     GET    /po                     — list (status/supplier/paginate)
 *     POST   /po                     — create incl. items (berekent subtotal/tax/total)
 *     GET    /po/:id                 — detail incl. items
 *     PATCH  /po/:id                 — update header + status-transitie (+ items zolang draft)
 *     DELETE /po/:id                 — verwijder (alleen draft|cancelled)
 *     POST   /po/:id/receive         — ontvangst: zet quantity_received + stock-movements
 *
 * Conventies (Wave-1 backend-contract):
 *   - Geld = string (numeric(12,4)). inArray() i.p.v. ANY().
 *   - Writes met audit/transactie via runInTransactionWithAudit.
 *   - 400 {error:'invalid_request', details} bij zod-fout.
 *
 * Wired in routes/index.ts door finalizer (zie REGISTER.md). NIET zelf mounten.
 */
import { Hono } from 'hono';
import { and, asc, desc, eq, ilike, inArray, count } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { suppliers } from '../../db/schema/suppliers.js';
import { purchaseOrders } from '../../db/schema/purchase-orders.js';
import { purchaseOrderItems } from '../../db/schema/purchase-order-items.js';
import { inventoryItems } from '../../db/schema/inventory-items.js';
import { inventoryMovements } from '../../db/schema/inventory-movements.js';
import { locations } from '../../db/schema/locations.js';
import {
  applyDeltaAndRecompute,
  NegativeStockError,
} from '../../domain/stock/available-recompute.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import {
  toSupplierDto,
  toPurchaseOrderWithItems,
  toPurchaseOrderDto,
} from './_serialize.js';
import {
  SupplierCreateSchema,
  SupplierUpdateSchema,
  SupplierListQuerySchema,
  PurchaseOrderCreateSchema,
  PurchaseOrderUpdateSchema,
  PurchaseOrderListQuerySchema,
  ReceiveSchema,
  PO_TRANSITIONS,
  computeTotals,
  type PoStatus,
} from './_schemas.js';

export const purchasingRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles (admin-module).
purchasingRoutes.use('*', requireAuth);

// ─── helpers ─────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string | undefined | null): v is string {
  return typeof v === 'string' && UUID_REGEX.test(v);
}

// ════════════════════════════════════════════════════════════════
// SUPPLIERS
// ════════════════════════════════════════════════════════════════

purchasingRoutes.get('/suppliers', async (c) => {
  const parsed = SupplierListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset, search, active } = parsed.data;

  const conditions = [];
  if (search) conditions.push(ilike(suppliers.name, `%${search}%`));
  if (active !== undefined) conditions.push(eq(suppliers.active, active));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(suppliers)
    .orderBy(asc(suppliers.name))
    .limit(limit)
    .offset(offset);
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const totalQuery = db.select({ c: count() }).from(suppliers);
  const totalRes = whereExpr ? await totalQuery.where(whereExpr) : await totalQuery;
  const total = Number(totalRes[0]?.c ?? 0);

  return c.json({ items: rows.map(toSupplierDto), total, limit, offset });
});

purchasingRoutes.post('/suppliers', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = SupplierCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? null;

  const supplier = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .insert(suppliers)
      .values({
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        leadTimeDays: input.leadTimeDays ?? 7,
        currency: input.currency ?? 'EUR',
        notes: input.notes ?? null,
        active: input.active ?? true,
      })
      .returning();
    if (!row) throw new Error('supplier insert returned no row');
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'supplier',
      entityId: row.id,
      after: { id: row.id, name: row.name },
      ip,
    });
    return row;
  });

  return c.json({ supplier: toSupplierDto(supplier) }, 201);
});

purchasingRoutes.get('/suppliers/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ supplier: toSupplierDto(row) });
});

purchasingRoutes.patch('/suppliers/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = SupplierUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? null;

  const [existing] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.email !== undefined) patch.email = input.email ?? null;
  if (input.phone !== undefined) patch.phone = input.phone ?? null;
  if (input.address !== undefined) patch.address = input.address ?? null;
  if (input.leadTimeDays !== undefined) patch.leadTimeDays = input.leadTimeDays;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.notes !== undefined) patch.notes = input.notes ?? null;
  if (input.active !== undefined) patch.active = input.active;

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(suppliers)
      .set(patch)
      .where(eq(suppliers.id, id))
      .returning();
    if (!row) throw new Error('supplier update returned no row');
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'supplier',
      entityId: row.id,
      before: { name: existing.name, active: existing.active },
      after: { name: row.name, active: row.active },
      ip,
    });
    return row;
  });

  return c.json({ supplier: toSupplierDto(updated) });
});

purchasingRoutes.delete('/suppliers/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const hard = c.req.query('hard') === 'true';
  const ip = c.req.header('x-forwarded-for') ?? null;

  const [existing] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  // Hard-delete alleen als geen PO's verwijzen (FK is restrict — anders 409).
  if (hard) {
    const [{ c: poCount } = { c: 0 }] = await db
      .select({ c: count() })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.supplierId, id));
    if (Number(poCount) > 0) {
      return c.json(
        { error: 'supplier_in_use', message: 'Supplier has purchase-orders; deactivate instead.' },
        409,
      );
    }
  }

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    let row;
    if (hard) {
      [row] = await tx.delete(suppliers).where(eq(suppliers.id, id)).returning();
    } else {
      [row] = await tx
        .update(suppliers)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(suppliers.id, id))
        .returning();
    }
    audit.set({
      actor: { type: 'user', id: user.id },
      action: hard ? 'delete' : 'update',
      entityType: 'supplier',
      entityId: id,
      before: { name: existing.name, active: existing.active },
      after: hard ? null : { active: false },
      ip,
    });
    return row;
  });

  return c.json({ ok: true, supplier: result ? toSupplierDto(result) : null, hard });
});

// ════════════════════════════════════════════════════════════════
// PURCHASE ORDERS
// ════════════════════════════════════════════════════════════════

purchasingRoutes.get('/po', async (c) => {
  const parsed = PurchaseOrderListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset, status, supplierId } = parsed.data;

  const conditions = [];
  if (status) conditions.push(eq(purchaseOrders.status, status));
  if (supplierId) conditions.push(eq(purchaseOrders.supplierId, supplierId));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(purchaseOrders)
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(limit)
    .offset(offset);
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const totalQuery = db.select({ c: count() }).from(purchaseOrders);
  const totalRes = whereExpr ? await totalQuery.where(whereExpr) : await totalQuery;
  const total = Number(totalRes[0]?.c ?? 0);

  // item-counts voor de zichtbare set (inArray, niet ANY)
  const poIds = rows.map((r) => r.id);
  const itemCount = new Map<string, number>();
  if (poIds.length > 0) {
    const counts = await db
      .select({ poId: purchaseOrderItems.poId, c: count() })
      .from(purchaseOrderItems)
      .where(inArray(purchaseOrderItems.poId, poIds))
      .groupBy(purchaseOrderItems.poId);
    for (const r of counts) itemCount.set(r.poId, Number(r.c));
  }

  return c.json({
    items: rows.map((po) => ({
      ...toPurchaseOrderDto(po),
      itemCount: itemCount.get(po.id) ?? 0,
    })),
    total,
    limit,
    offset,
  });
});

purchasingRoutes.post('/po', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = PurchaseOrderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? null;

  // Bestaanschecks buiten de transactie (snel falen).
  const [supplier] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.id, input.supplierId))
    .limit(1);
  if (!supplier) return c.json({ error: 'supplier_not_found' }, 404);

  if (input.locationId) {
    const [loc] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.id, input.locationId))
      .limit(1);
    if (!loc) return c.json({ error: 'location_not_found' }, 404);
  }

  const totals = computeTotals(input.items, input.taxRate ?? 0);

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        supplierId: input.supplierId,
        locationId: input.locationId ?? null,
        reference: input.reference ?? null,
        status: 'draft',
        currency: input.currency ?? 'EUR',
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
        notes: input.notes ?? null,
      })
      .returning();
    if (!po) throw new Error('purchase_order insert returned no row');

    const itemRows = await tx
      .insert(purchaseOrderItems)
      .values(
        input.items.map((it) => ({
          poId: po.id,
          variantId: it.variantId ?? null,
          sku: it.sku ?? null,
          quantity: it.quantity,
          unitCost: it.unitCost ?? null,
          quantityReceived: 0,
        })),
      )
      .returning();

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'purchase_order',
      entityId: po.id,
      after: { id: po.id, status: po.status, total: po.total, itemCount: itemRows.length },
      ip,
    });

    return { po, itemRows };
  });

  return c.json(
    { purchaseOrder: toPurchaseOrderWithItems(result.po, result.itemRows) },
    201,
  );
});

purchasingRoutes.get('/po/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
  if (!po) return c.json({ error: 'not_found' }, 404);

  const items = await db
    .select()
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.poId, id))
    .orderBy(asc(purchaseOrderItems.id));

  return c.json({ purchaseOrder: toPurchaseOrderWithItems(po, items) });
});

purchasingRoutes.patch('/po/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = PurchaseOrderUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? null;

  const [existing] = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  // Status-transitie valideren.
  if (input.status && input.status !== existing.status) {
    const allowed = PO_TRANSITIONS[existing.status as PoStatus] ?? [];
    if (!allowed.includes(input.status)) {
      return c.json(
        {
          error: 'invalid_status_transition',
          from: existing.status,
          to: input.status,
          allowed,
        },
        409,
      );
    }
  }

  // Items vervangen mag alleen zolang status === 'draft'.
  if (input.items && existing.status !== 'draft') {
    return c.json(
      { error: 'items_locked', message: 'Items can only be replaced while status is draft.' },
      409,
    );
  }

  if (input.locationId) {
    const [loc] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.id, input.locationId))
      .limit(1);
    if (!loc) return c.json({ error: 'location_not_found' }, 404);
  }

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.locationId !== undefined) patch.locationId = input.locationId ?? null;
    if (input.reference !== undefined) patch.reference = input.reference ?? null;
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.expectedAt !== undefined)
      patch.expectedAt = input.expectedAt ? new Date(input.expectedAt) : null;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;

    // Status-transitie + timestamps.
    if (input.status && input.status !== existing.status) {
      patch.status = input.status;
      if (input.status === 'ordered' && !existing.orderedAt) patch.orderedAt = new Date();
      if (input.status === 'received') patch.receivedAt = new Date();
    }

    // Items vervangen (draft) → herbereken totals.
    let newItems = null;
    if (input.items) {
      await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.poId, id));
      newItems = await tx
        .insert(purchaseOrderItems)
        .values(
          input.items.map((it) => ({
            poId: id,
            variantId: it.variantId ?? null,
            sku: it.sku ?? null,
            quantity: it.quantity,
            unitCost: it.unitCost ?? null,
            quantityReceived: 0,
          })),
        )
        .returning();
      const totals = computeTotals(input.items, input.taxRate ?? 0);
      patch.subtotal = totals.subtotal;
      patch.taxTotal = totals.taxTotal;
      patch.total = totals.total;
    }

    const [po] = await tx
      .update(purchaseOrders)
      .set(patch)
      .where(eq(purchaseOrders.id, id))
      .returning();
    if (!po) throw new Error('purchase_order update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'purchase_order',
      entityId: po.id,
      before: { status: existing.status, total: existing.total },
      after: { status: po.status, total: po.total },
      ip,
    });

    const items =
      newItems ??
      (await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.poId, id))
        .orderBy(asc(purchaseOrderItems.id)));

    return { po, items };
  });

  return c.json({ purchaseOrder: toPurchaseOrderWithItems(result.po, result.items) });
});

purchasingRoutes.delete('/po/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? null;

  const [existing] = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  // Alleen draft of cancelled mag echt weg (received/ordered houden we als historie).
  if (existing.status !== 'draft' && existing.status !== 'cancelled') {
    return c.json(
      {
        error: 'delete_not_allowed',
        message: 'Only draft or cancelled purchase-orders can be deleted; cancel it first.',
        status: existing.status,
      },
      409,
    );
  }

  await runInTransactionWithAudit(async (tx, audit) => {
    // items cascaden via FK, maar we verwijderen expliciet voor de duidelijkheid.
    await tx.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'purchase_order',
      entityId: id,
      before: { status: existing.status, total: existing.total },
      after: null,
      ip,
    });
    return undefined;
  });

  return c.json({ ok: true, id });
});

// ════════════════════════════════════════════════════════════════
// RECEIVE — ontvangst van een PO
// ════════════════════════════════════════════════════════════════

purchasingRoutes.post('/po/:id/receive', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ReceiveSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? null;

  // PO + items ophalen.
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
  if (!po) return c.json({ error: 'not_found' }, 404);
  if (po.status === 'cancelled') return c.json({ error: 'po_cancelled' }, 409);
  if (po.status === 'received') return c.json({ error: 'po_already_received' }, 409);

  const poItems = await db
    .select()
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.poId, id));
  const itemById = new Map(poItems.map((it) => [it.id, it]));

  // Doel-location: body-override of po.location_id.
  const locationId = input.locationId ?? po.locationId;
  if (!locationId) {
    return c.json(
      { error: 'location_required', message: 'PO has no location_id; supply locationId in body.' },
      422,
    );
  }
  const [loc] = await db
    .select({ id: locations.id, active: locations.active })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  if (!loc) return c.json({ error: 'location_not_found' }, 404);
  if (!loc.active) return c.json({ error: 'location_inactive' }, 422);

  // Valideer lines: bestaan, niet over-ontvangen, hebben een variant (voor stock).
  for (const line of input.lines) {
    const poItem = itemById.get(line.itemId);
    if (!poItem) {
      return c.json({ error: 'po_item_not_found', itemId: line.itemId }, 404);
    }
    const remaining = poItem.quantity - poItem.quantityReceived;
    if (line.quantity > remaining) {
      return c.json(
        {
          error: 'over_receive',
          itemId: line.itemId,
          remaining,
          requested: line.quantity,
        },
        422,
      );
    }
  }

  // variant→inventory_item resolven voor alle betrokken lines (inArray, niet ANY).
  const variantIds = input.lines
    .map((l) => itemById.get(l.itemId)?.variantId)
    .filter((v): v is string => !!v);
  const invItemByVariant = new Map<string, string>();
  if (variantIds.length > 0) {
    const invRows = await db
      .select({ id: inventoryItems.id, variantId: inventoryItems.variantId })
      .from(inventoryItems)
      .where(inArray(inventoryItems.variantId, variantIds));
    for (const r of invRows) invItemByVariant.set(r.variantId, r.id);
  }

  try {
    const result = await runInTransactionWithAudit(async (tx, audit) => {
      const receivedLines: Array<{
        itemId: string;
        variantId: string | null;
        quantity: number;
        stockMovementId: string | null;
        newOnHand: number | null;
      }> = [];

      for (const line of input.lines) {
        const poItem = itemById.get(line.itemId)!;

        // 1. quantity_received ophogen.
        await tx
          .update(purchaseOrderItems)
          .set({ quantityReceived: poItem.quantityReceived + line.quantity })
          .where(eq(purchaseOrderItems.id, poItem.id));

        // 2. stock-movement + level-recompute (alleen als variant→inventory_item bestaat).
        let stockMovementId: string | null = null;
        let newOnHand: number | null = null;
        const invItemId = poItem.variantId
          ? invItemByVariant.get(poItem.variantId)
          : undefined;

        if (invItemId) {
          const level = await applyDeltaAndRecompute(tx, {
            itemId: invItemId,
            locationId,
            delta: line.quantity,
          });
          newOnHand = level.onHand;
          const [movement] = await tx
            .insert(inventoryMovements)
            .values({
              itemId: invItemId,
              locationId,
              delta: line.quantity,
              reason: 'po_receive',
              refType: 'po',
              refId: po.id,
              actorId: user.id,
              note: input.note ?? null,
            })
            .returning();
          stockMovementId = movement?.id ?? null;
        }

        receivedLines.push({
          itemId: poItem.id,
          variantId: poItem.variantId,
          quantity: line.quantity,
          stockMovementId,
          newOnHand,
        });
      }

      // 3. PO-status herberekenen op basis van totaal-ontvangst.
      const updatedItems = await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.poId, id));
      const fullyReceived = updatedItems.every(
        (it) => it.quantityReceived >= it.quantity,
      );
      const anyReceived = updatedItems.some((it) => it.quantityReceived > 0);
      const newStatus: PoStatus = fullyReceived
        ? 'received'
        : anyReceived
          ? 'partial'
          : (po.status as PoStatus);

      const poPatch: Record<string, unknown> = {
        status: newStatus,
        updatedAt: new Date(),
      };
      if (newStatus === 'received') poPatch.receivedAt = new Date();

      const [updatedPo] = await tx
        .update(purchaseOrders)
        .set(poPatch)
        .where(eq(purchaseOrders.id, id))
        .returning();
      if (!updatedPo) throw new Error('purchase_order update returned no row');

      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'receive',
        entityType: 'purchase_order',
        entityId: id,
        before: { status: po.status },
        after: {
          status: newStatus,
          locationId,
          lines: receivedLines,
        },
        ip,
      });

      return { updatedPo, updatedItems, receivedLines, newStatus };
    });

    logger.info(
      {
        poId: id,
        actor: user.id,
        locationId,
        lines: result.receivedLines.length,
        status: result.newStatus,
      },
      'po receive ok',
    );

    return c.json({
      ok: true,
      purchaseOrder: toPurchaseOrderWithItems(result.updatedPo, result.updatedItems),
      received: result.receivedLines,
    });
  } catch (err) {
    if (err instanceof NegativeStockError) {
      // Receive verhoogt on_hand altijd, dus dit zou niet mogen — defensief.
      return c.json({ error: 'negative_stock', message: err.message }, 422);
    }
    logger.error({ err, poId: id }, 'po receive failed');
    throw err;
  }
});
