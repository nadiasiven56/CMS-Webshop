/**
 * Returns / RMA. Twee mount-paden (Atlas wired beide — zie REGISTER.md):
 *   - genest onder order:   POST/GET /api/orders/:id/returns
 *   - top-level RMA-board:  GET/POST /api/returns, GET/PATCH /api/returns/:rid
 *
 * Een return hangt aan een shop (verplicht) en optioneel aan een order.
 * `return_items` koppelen aan `order_items` met quantity + restock-flag.
 * refund_amount = string (Money).
 *
 * Alles via `runInTransactionWithAudit` (entityType 'return').
 */
import type { Context } from 'hono';
import { and, eq, asc, desc } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { orders } from '../../db/schema/orders.js';
import type { Order } from '../../db/schema/orders.js';
import { orderItems } from '../../db/schema/order-items.js';
import { returns } from '../../db/schema/returns.js';
import type { Return } from '../../db/schema/returns.js';
import { returnItems } from '../../db/schema/return-items.js';
import { inventoryItems } from '../../db/schema/inventory-items.js';
import { inventoryLevels } from '../../db/schema/inventory-levels.js';
import { inventoryMovements } from '../../db/schema/inventory-movements.js';
import { locations } from '../../db/schema/locations.js';
import {
  runInTransactionWithAudit,
  type AuditActor,
} from '../../domain/stock/transaction-helpers.js';
import { applyDeltaAndRecompute, type DbOrTx } from '../../domain/stock/available-recompute.js';
import { postRefund } from '../../domain/finance/ledger-posting.js';
import { money } from '@webshop-crm/shared/types/money';
import { isUuid } from '../products/_validate.js';
import {
  ReturnCreateSchema,
  ReturnUpdateSchema,
  ReturnListQuerySchema,
} from './_schemas.js';
import { toReturnDto } from './_serialize.js';
import { fireReturnEvent } from '../../domain/orchestration/order-events.js';

/**
 * Laad de contact-velden (email/ordernummer/valuta) van de order achter een
 * return, voor de notificatie-mail. Best-effort: geen order → null. Throwt nooit.
 */
async function loadOrderContact(
  orderId: string | null,
): Promise<{ email: string | null; orderNumber: string | null; currency: string | null } | null> {
  if (!orderId) return null;
  try {
    const [row] = await db
      .select({ email: orders.email, orderNumber: orders.orderNumber, currency: orders.currency })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

// ─── Refund-effecten (ledger + restock) ──────────────────────

/**
 * Resolve een default-locatie om naar terug te boeken bij restock: bij voorkeur
 * een location waar dit inventory-item AL een level-row heeft (zo blijven we op
 * dezelfde voorraad-locatie als waar verkocht/ontvangen is). Valt dat weg, dan
 * de actieve location met de hoogste prioriteit (laagste `priority`-waarde).
 */
async function resolveRestockLocation(
  tx: DbOrTx,
  itemId: string,
): Promise<string | null> {
  const [existing] = await tx
    .select({ locationId: inventoryLevels.locationId })
    .from(inventoryLevels)
    .where(eq(inventoryLevels.itemId, itemId))
    .orderBy(desc(inventoryLevels.onHand))
    .limit(1);
  if (existing) return existing.locationId;

  const [fallback] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.active, true))
    .orderBy(asc(locations.priority), asc(locations.code))
    .limit(1);
  return fallback?.id ?? null;
}

export interface RefundEffectsResult {
  ledgerEntriesPosted: number;
  restockedItems: number;
  restockedUnits: number;
}

/**
 * Voer de effecten van een 'refunded'-return uit BINNEN de gegeven tx:
 *   1) postRefund(tx, order, refundAmount) — gebalanceerde refund-boeking
 *      (idempotent op bedrag is NIET gegarandeerd door de helper; we roepen dit
 *       alleen aan op de transitie naar 'refunded', zie callers).
 *   2) per return_item met restock===true: increment inventory_levels
 *      (on_hand + available via applyDeltaAndRecompute) + inventory_movements
 *      row (reason 'return_restock', refType 'return', refId = return.id).
 *
 * Geen order → geen ledger + geen restock (return zonder order kan niet naar
 * order-items mappen). refundAmount<=0 → geen ledger-regels (postRefund guard).
 */
async function applyRefundEffects(
  tx: DbOrTx,
  ret: Return,
  actor: AuditActor,
): Promise<RefundEffectsResult> {
  const result: RefundEffectsResult = {
    ledgerEntriesPosted: 0,
    restockedItems: 0,
    restockedUnits: 0,
  };

  if (!ret.orderId) return result; // geen order → niets te boeken/restocken

  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, ret.orderId))
    .limit(1);
  if (!order) return result;

  // 1) Refund-boeking
  result.ledgerEntriesPosted = await postRefund(tx, order as Order, ret.refundAmount);

  // 2) Restock per return_item
  const ris = await tx.select().from(returnItems).where(eq(returnItems.returnId, ret.id));
  for (const ri of ris) {
    if (!ri.restock) continue;
    if (!ri.orderItemId) continue;
    const qty = ri.quantity ?? 0;
    if (qty <= 0) continue;

    // return_item -> order_item -> variant -> inventory_item.id
    const [oi] = await tx
      .select({ variantId: orderItems.variantId })
      .from(orderItems)
      .where(eq(orderItems.id, ri.orderItemId))
      .limit(1);
    if (!oi?.variantId) continue;

    const [inv] = await tx
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(eq(inventoryItems.variantId, oi.variantId))
      .limit(1);
    if (!inv) continue; // variant zonder tracked inventory-item → skip

    const locationId = await resolveRestockLocation(tx, inv.id);
    if (!locationId) continue;

    // on_hand + available omhoog (force: voorraad kan nooit negatief worden bij +).
    await applyDeltaAndRecompute(tx, {
      itemId: inv.id,
      locationId,
      delta: qty,
      force: true,
    });

    await tx.insert(inventoryMovements).values({
      itemId: inv.id,
      locationId,
      delta: qty,
      reason: 'return_restock',
      refType: 'return',
      refId: ret.id,
      actorId: actor.id ?? null,
      note: `Restock voor return ${ret.id}`,
    });

    result.restockedItems += 1;
    result.restockedUnits += qty;
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────

async function insertReturnWithItems(
  tx: Parameters<Parameters<typeof runInTransactionWithAudit>[0]>[0],
  values: {
    shopId: string;
    orderId: string | null;
    reason: string | null;
    refundAmount: string;
    status: string;
  },
  items: Array<{ orderItemId: string | null; quantity: number | null; restock: boolean }>,
) {
  const [ret] = await tx
    .insert(returns)
    .values({
      shopId: values.shopId,
      orderId: values.orderId,
      reason: values.reason,
      refundAmount: values.refundAmount,
      status: values.status,
    })
    .returning();
  if (!ret) throw new Error('return insert returned no row');

  const insertedItems = [];
  for (const it of items) {
    const [riRow] = await tx
      .insert(returnItems)
      .values({
        returnId: ret.id,
        orderItemId: it.orderItemId,
        quantity: it.quantity,
        restock: it.restock,
      })
      .returning();
    if (riRow) insertedItems.push(riRow);
  }
  return { ret, insertedItems };
}

// ─── Create (order-scoped) — POST /api/orders/:id/returns ────

export async function createReturnForOrder(c: Context): Promise<Response> {
  const orderId = c.req.param('id');
  if (!isUuid(orderId)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const body = await c.req.json().catch(() => null);
  const parsed = ReturnCreateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const [order] = await db
    .select({ id: orders.id, shopId: orders.shopId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return c.json({ error: 'order_not_found' }, 404);

  // Over-refund-guard: weiger als de totale terugbetaling het order-totaal
  // overschrijdt (anders crediteert het grootboek meer dan ooit verkocht).
  if (input.status === 'refunded' && input.refundAmount) {
    const capErr = await refundCapError(orderId, money(input.refundAmount));
    if (capErr) {
      return c.json(
        {
          error: 'refund_exceeds_order',
          message: `Totale terugbetaling € ${capErr.total} overschrijdt het order-totaal € ${capErr.orderTotal} (al terugbetaald € ${capErr.alreadyRefunded}).`,
          ...capErr,
        },
        409,
      );
    }
  }

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const created = await insertReturnWithItems(
      tx,
      {
        shopId: order.shopId,
        orderId: order.id,
        reason: input.reason ?? null,
        refundAmount: input.refundAmount ? money(input.refundAmount) : '0',
        status: input.status,
      },
      input.items.map((it) => ({
        orderItemId: it.orderItemId ?? null,
        quantity: it.quantity ?? null,
        restock: it.restock,
      })),
    );
    let effects: RefundEffectsResult | undefined;
    if (created.ret.status === 'refunded') {
      effects = await applyRefundEffects(tx, created.ret, { type: 'user', id: user.id });
    }
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'return',
      entityId: created.ret.id,
      after: {
        id: created.ret.id,
        orderId,
        status: created.ret.status,
        refundAmount: created.ret.refundAmount,
        ...(effects ? { refundEffects: effects } : {}),
      },
      ip,
    });
    return created;
  });

  // ── Side-effects (koppel-klaar; fire-and-forget, NA de tx) ──
  void (async () => {
    const contact = await loadOrderContact(result.ret.orderId);
    await fireReturnEvent(result.ret, contact, {
      refunded: result.ret.status === 'refunded',
    });
  })();

  return c.json({ return: toReturnDto(result.ret, result.insertedItems) }, 201);
}

/**
 * Over-refund-guard: het cumulatief terugbetaalde bedrag (bestaande 'refunded'
 * returns + dit verzoek) mag het order-totaal niet overschrijden. Geeft een
 * fout-detail terug bij overschrijding, anders null. (Operator-gedreven, lage
 * concurrency → geen lock; de check leest buiten de tx.)
 */
async function refundCapError(
  orderId: string,
  requestedRefund: string,
): Promise<{ alreadyRefunded: string; orderTotal: string; total: string } | null> {
  const [order] = await db
    .select({ grandTotal: orders.grandTotal })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return null;
  const existing = await db
    .select({ refundAmount: returns.refundAmount, status: returns.status })
    .from(returns)
    .where(eq(returns.orderId, orderId));
  const already = existing
    .filter((r) => r.status === 'refunded')
    .reduce((acc, r) => acc + Number(r.refundAmount ?? 0), 0);
  const total = already + Number(requestedRefund ?? 0);
  const cap = Number(order.grandTotal ?? 0);
  if (total > cap + 0.0001) {
    return {
      alreadyRefunded: already.toFixed(2),
      orderTotal: cap.toFixed(2),
      total: total.toFixed(2),
    };
  }
  return null;
}

export async function listReturnsForOrder(c: Context): Promise<Response> {
  const orderId = c.req.param('id');
  if (!isUuid(orderId)) return c.json({ error: 'invalid_id' }, 400);

  const rows = await db
    .select()
    .from(returns)
    .where(eq(returns.orderId, orderId))
    .orderBy(desc(returns.createdAt));
  const withItems = await Promise.all(
    rows.map(async (r) => {
      const ris = await db.select().from(returnItems).where(eq(returnItems.returnId, r.id));
      return toReturnDto(r, ris);
    }),
  );
  return c.json({ returns: withItems });
}

// ─── Top-level RMA-board ─────────────────────────────────────

export async function listReturns(c: Context): Promise<Response> {
  const parsed = ReturnListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { shop_id, order_id, status, limit, offset } = parsed.data;

  const conditions = [];
  if (shop_id) conditions.push(eq(returns.shopId, shop_id));
  if (order_id) conditions.push(eq(returns.orderId, order_id));
  if (status) conditions.push(eq(returns.status, status));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const q = db.select().from(returns).orderBy(desc(returns.createdAt)).limit(limit).offset(offset);
  const rows = whereExpr ? await q.where(whereExpr) : await q;

  return c.json({
    items: rows.map((r) => toReturnDto(r)),
    limit,
    offset,
  });
}

export async function getReturn(c: Context): Promise<Response> {
  const rid = c.req.param('rid');
  if (!isUuid(rid)) return c.json({ error: 'invalid_id' }, 400);

  const [r] = await db.select().from(returns).where(eq(returns.id, rid)).limit(1);
  if (!r) return c.json({ error: 'not_found' }, 404);
  const ris = await db.select().from(returnItems).where(eq(returnItems.returnId, rid));
  return c.json({ return: toReturnDto(r, ris) });
}

export async function createReturn(c: Context): Promise<Response> {
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const body = await c.req.json().catch(() => null);
  const parsed = ReturnCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  // shop_id moet bekend zijn: expliciet of via order
  let shopId = input.shopId ?? null;
  const orderId = input.orderId ?? null;
  if (orderId) {
    const [order] = await db
      .select({ id: orders.id, shopId: orders.shopId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return c.json({ error: 'order_not_found' }, 404);
    shopId = shopId ?? order.shopId;
  }
  if (!shopId) {
    return c.json({ error: 'invalid_request', message: 'shopId or orderId required' }, 400);
  }

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const created = await insertReturnWithItems(
      tx,
      {
        shopId: shopId as string,
        orderId,
        reason: input.reason ?? null,
        refundAmount: input.refundAmount ? money(input.refundAmount) : '0',
        status: input.status,
      },
      input.items.map((it) => ({
        orderItemId: it.orderItemId ?? null,
        quantity: it.quantity ?? null,
        restock: it.restock,
      })),
    );
    let effects: RefundEffectsResult | undefined;
    if (created.ret.status === 'refunded') {
      effects = await applyRefundEffects(tx, created.ret, { type: 'user', id: user.id });
    }
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'return',
      entityId: created.ret.id,
      after: {
        id: created.ret.id,
        shopId,
        orderId,
        status: created.ret.status,
        ...(effects ? { refundEffects: effects } : {}),
      },
      ip,
    });
    return created;
  });

  // ── Side-effects (koppel-klaar; fire-and-forget, NA de tx) ──
  void (async () => {
    const contact = await loadOrderContact(result.ret.orderId);
    await fireReturnEvent(result.ret, contact, {
      refunded: result.ret.status === 'refunded',
    });
  })();

  return c.json({ return: toReturnDto(result.ret, result.insertedItems) }, 201);
}

export async function updateReturn(c: Context): Promise<Response> {
  const rid = c.req.param('rid');
  if (!isUuid(rid)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const body = await c.req.json().catch(() => null);
  const parsed = ReturnUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const [existing] = await db.select().from(returns).where(eq(returns.id, rid)).limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.status !== undefined) patch.status = input.status;
  if (input.reason !== undefined) patch.reason = input.reason;
  if (input.refundAmount !== undefined) patch.refundAmount = money(input.refundAmount);

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx.update(returns).set(patch).where(eq(returns.id, rid)).returning();
    if (!row) throw new Error('return update returned no row');

    // Effecten alleen op de TRANSITIE naar 'refunded' (niet bij re-update van een
    // al-refunded return → voorkomt dubbele refund-boeking + dubbele restock).
    let effects: RefundEffectsResult | undefined;
    if (row.status === 'refunded' && existing.status !== 'refunded') {
      effects = await applyRefundEffects(tx, row, { type: 'user', id: user.id });
    }

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'return',
      entityId: rid,
      before: { status: existing.status, refundAmount: existing.refundAmount },
      after: {
        status: row.status,
        refundAmount: row.refundAmount,
        ...(effects ? { refundEffects: effects } : {}),
      },
      ip,
    });
    return row;
  });

  // ── Side-effects (koppel-klaar; fire-and-forget, NA de tx) ──
  // Alleen op een ECHTE status-transitie naar 'received'/'refunded' (niet bij
  // re-updates of reason-edits), zodat webhook + mail per return één keer vuren.
  const becameProcessed =
    updated.status !== existing.status &&
    (updated.status === 'received' || updated.status === 'refunded');
  if (becameProcessed) {
    void (async () => {
      const contact = await loadOrderContact(updated.orderId);
      await fireReturnEvent(updated, contact, {
        refunded: updated.status === 'refunded',
      });
    })();
  }

  const ris = await db.select().from(returnItems).where(eq(returnItems.returnId, rid));
  return c.json({ return: toReturnDto(updated, ris) });
}
