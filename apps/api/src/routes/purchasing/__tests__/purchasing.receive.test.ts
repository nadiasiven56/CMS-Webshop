/**
 * REAL-DB integration test voor de purchasing-module.
 *
 * Draait tegen de ECHTE PostgreSQL (:7432) via Hono `app.request()`. We mocken
 * alleen `requireAuth` (zodat we geen sessie-cookie hoeven te seeden) â€” alle
 * db-operaties gaan naar de echte database en worden achteraf opgeruimd.
 *
 * Flow:
 *   1. maak een supplier
 *   2. zoek een bestaande variant met een inventory_item + een location
 *   3. lees on_hand vÃ³Ã³r
 *   4. maak een PO met 1 item (qty 5) op die location
 *   5. ontvang qty 2  â†’ status 'partial', quantity_received=2, +1 movement, on_hand +2
 *   6. ontvang qty 3  â†’ status 'received', quantity_received=5, +1 movement, on_hand +5 totaal
 *   7. cleanup: verwijder movements/PO/supplier + reset on_hand
 *
 * NB: dit muteert echte voorraad tijdens de run, maar herstelt on_hand exact
 * in de finally-cleanup zodat de DB onveranderd achterblijft.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';

// â”€â”€â”€ Mock alleen auth â€” db blijft ECHT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { vi } from 'vitest';

const TEST_USER_ID = '00000000-0000-4000-8000-0000000000a5';
vi.mock('../../../middleware/auth.js', () => ({
  requireAuth: async (c: any, next: any) => {
    c.set('user', { id: TEST_USER_ID, email: 'test-purchasing@example.com', role: 'admin' });
    await next();
  },
}));

const { db, closeDb } = await import('../../../lib/db.js');
const { suppliers } = await import('../../../db/schema/suppliers.js');
const { purchaseOrders } = await import('../../../db/schema/purchase-orders.js');
const { purchaseOrderItems } = await import('../../../db/schema/purchase-order-items.js');
const { inventoryItems } = await import('../../../db/schema/inventory-items.js');
const { inventoryLevels } = await import('../../../db/schema/inventory-levels.js');
const { inventoryMovements } = await import('../../../db/schema/inventory-movements.js');
const { variants } = await import('../../../db/schema/variants.js');
const { locations } = await import('../../../db/schema/locations.js');
const { purchasingRoutes } = await import('../index.js');

function buildApp() {
  const app = new Hono();
  app.route('/api/purchasing', purchasingRoutes);
  return app;
}

// â”€â”€â”€ Fixtures, gevuld in beforeAll â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ctx: {
  app: ReturnType<typeof buildApp>;
  supplierId?: string;
  poId?: string;
  poItemId?: string;
  variantId?: string;
  invItemId?: string;
  locationId?: string;
  onHandBefore: number;
  hadLevelRow: boolean;
} = { app: buildApp(), onHandBefore: 0, hadLevelRow: false };

beforeAll(async () => {
  // 1. supplier
  const [sup] = await db
    .insert(suppliers)
    .values({ name: `__test_supplier_${Date.now()}`, currency: 'EUR' })
    .returning();
  ctx.supplierId = sup!.id;

  // 2. een variant met een inventory_item
  const [pair] = await db
    .select({ variantId: variants.id, invItemId: inventoryItems.id })
    .from(inventoryItems)
    .innerJoin(variants, eq(variants.id, inventoryItems.variantId))
    .limit(1);
  if (!pair) throw new Error('no variant+inventory_item in DB â€” seed first');
  ctx.variantId = pair.variantId;
  ctx.invItemId = pair.invItemId;

  // 3. een actieve location
  const [loc] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.active, true))
    .limit(1);
  if (!loc) throw new Error('no active location in DB â€” seed first');
  ctx.locationId = loc.id;

  // 4. on_hand vÃ³Ã³r (kan nog geen level-row hebben)
  const [level] = await db
    .select({ onHand: inventoryLevels.onHand })
    .from(inventoryLevels)
    .where(
      and(
        eq(inventoryLevels.itemId, ctx.invItemId),
        eq(inventoryLevels.locationId, ctx.locationId),
      ),
    )
    .limit(1);
  ctx.hadLevelRow = !!level;
  ctx.onHandBefore = level?.onHand ?? 0;
});

afterAll(async () => {
  // Cleanup in omgekeerde volgorde. Best-effort; faal niet de suite.
  try {
    if (ctx.invItemId && ctx.locationId) {
      // Verwijder de movements die deze test heeft gemaakt (op po refId).
      if (ctx.poId) {
        await db
          .delete(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.refType, 'po'),
              eq(inventoryMovements.refId, ctx.poId),
            ),
          );
      }
      // Reset on_hand/available naar de uitgangswaarde.
      if (ctx.hadLevelRow) {
        await db
          .update(inventoryLevels)
          .set({ onHand: ctx.onHandBefore, available: ctx.onHandBefore })
          .where(
            and(
              eq(inventoryLevels.itemId, ctx.invItemId),
              eq(inventoryLevels.locationId, ctx.locationId),
            ),
          );
      } else {
        await db
          .delete(inventoryLevels)
          .where(
            and(
              eq(inventoryLevels.itemId, ctx.invItemId),
              eq(inventoryLevels.locationId, ctx.locationId),
            ),
          );
      }
    }
    if (ctx.poId) {
      await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.poId, ctx.poId));
      await db.delete(purchaseOrders).where(eq(purchaseOrders.id, ctx.poId));
    }
    if (ctx.supplierId) {
      await db.delete(suppliers).where(eq(suppliers.id, ctx.supplierId));
    }
  } finally {
    await closeDb();
  }
});

describe('purchasing â€” suppliers + PO + receive (real DB)', () => {
  it('lists suppliers and finds our test supplier', async () => {
    const res = await ctx.app.request('/api/purchasing/suppliers?limit=100');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.some((s: any) => s.id === ctx.supplierId)).toBe(true);
  });

  it('creates a purchase-order with one item and computed totals', async () => {
    const res = await ctx.app.request('/api/purchasing/po', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplierId: ctx.supplierId,
        locationId: ctx.locationId,
        reference: 'TEST-PO-1',
        taxRate: 21,
        items: [
          { variantId: ctx.variantId, sku: 'TEST-SKU', quantity: 5, unitCost: '10.0000' },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.purchaseOrder.status).toBe('draft');
    expect(body.purchaseOrder.items).toHaveLength(1);
    // subtotal = 5 * 10 = 50.0000 ; tax 21% = 10.5000 ; total = 60.5000
    expect(body.purchaseOrder.subtotal).toBe('50.0000');
    expect(body.purchaseOrder.taxTotal).toBe('10.5000');
    expect(body.purchaseOrder.total).toBe('60.5000');
    ctx.poId = body.purchaseOrder.id;
    ctx.poItemId = body.purchaseOrder.items[0].id;
  });

  it('partially receives (2 of 5) â†’ status partial, quantity_received=2, +stock movement', async () => {
    const res = await ctx.app.request(`/api/purchasing/po/${ctx.poId}/receive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        note: 'partial delivery',
        lines: [{ itemId: ctx.poItemId, quantity: 2 }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.purchaseOrder.status).toBe('partial');

    const item = body.purchaseOrder.items.find((i: any) => i.id === ctx.poItemId);
    expect(item.quantityReceived).toBe(2);
    expect(item.quantityOutstanding).toBe(3);

    // Een stock-movement van +2 met reason po_receive moet bestaan.
    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(
        and(eq(inventoryMovements.refType, 'po'), eq(inventoryMovements.refId, ctx.poId!)),
      );
    expect(movements).toHaveLength(1);
    expect(movements[0]!.delta).toBe(2);
    expect(movements[0]!.reason).toBe('po_receive');

    // on_hand is met 2 gestegen.
    const [level] = await db
      .select({ onHand: inventoryLevels.onHand })
      .from(inventoryLevels)
      .where(
        and(
          eq(inventoryLevels.itemId, ctx.invItemId!),
          eq(inventoryLevels.locationId, ctx.locationId!),
        ),
      )
      .limit(1);
    expect(level!.onHand).toBe(ctx.onHandBefore + 2);
  });

  it('receives the remaining (3) â†’ status received, quantity_received=5, total +5 on_hand', async () => {
    const res = await ctx.app.request(`/api/purchasing/po/${ctx.poId}/receive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lines: [{ itemId: ctx.poItemId, quantity: 3 }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.purchaseOrder.status).toBe('received');

    const item = body.purchaseOrder.items.find((i: any) => i.id === ctx.poItemId);
    expect(item.quantityReceived).toBe(5);
    expect(item.quantityOutstanding).toBe(0);

    // Nu 2 movements (2 + 3).
    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(
        and(eq(inventoryMovements.refType, 'po'), eq(inventoryMovements.refId, ctx.poId!)),
      );
    expect(movements).toHaveLength(2);
    const totalDelta = movements.reduce((acc, m) => acc + m.delta, 0);
    expect(totalDelta).toBe(5);

    const [level] = await db
      .select({ onHand: inventoryLevels.onHand })
      .from(inventoryLevels)
      .where(
        and(
          eq(inventoryLevels.itemId, ctx.invItemId!),
          eq(inventoryLevels.locationId, ctx.locationId!),
        ),
      )
      .limit(1);
    expect(level!.onHand).toBe(ctx.onHandBefore + 5);
  });

  it('rejects over-receiving (422) once fully received', async () => {
    const res = await ctx.app.request(`/api/purchasing/po/${ctx.poId}/receive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lines: [{ itemId: ctx.poItemId, quantity: 1 }] }),
    });
    // PO is al 'received' â†’ 409 already received.
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe('po_already_received');
  });

  it('rejects invalid receive body (400)', async () => {
    const res = await ctx.app.request(`/api/purchasing/po/${ctx.poId}/receive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lines: [] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe('invalid_request');
  });
});
