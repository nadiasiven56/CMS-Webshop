/**
 * POST /api/orders — create order.
 *
 * - genereert per-shop `order_number` (bv 'CR-1001')
 * - berekent per item: line-net, tax_amount, line_total (incl btw) + marge
 * - berekent order-totalen: subtotal (ex), tax_total, grand_total
 * - alles in 1 transactie + audit-log ('create' op 'order')
 *
 * 201 { order: OrderWithItems }
 * 400 invalid_request · 404 shop_not_found
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { shops } from '../../db/schema/shops.js';
import { orders } from '../../db/schema/orders.js';
import { orderItems } from '../../db/schema/order-items.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { nextOrderNumber } from '../../domain/orders/order-number.js';
import { computeLine, computeOrderTotals, computeOrderMargin } from '../../domain/orders/order-math.js';
import { OrderCreateSchema } from './_schemas.js';
import { toOrderCore, toOrderItemDto } from './_serialize.js';

export async function createOrder(c: Context): Promise<Response> {
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const body = await c.req.json().catch(() => null);
  const parsed = OrderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  // Bereken regels (gooit bij invalide money/qty → vang als 400)
  let lines;
  try {
    lines = input.items.map((it) => ({
      input: it,
      computed: computeLine({
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        taxRate: it.taxRate ?? '21',
        costPrice: it.costPrice ?? null,
      }),
    }));
  } catch (err) {
    return c.json(
      { error: 'invalid_request', message: err instanceof Error ? err.message : 'invalid items' },
      400,
    );
  }

  const totals = computeOrderTotals(
    lines.map((l) => l.computed),
    { shippingTotal: input.shippingTotal, discountTotal: input.discountTotal },
  );

  // Shop bestaan + slug ophalen (voor order_number-prefix)
  const [shop] = await db
    .select({ id: shops.id, slug: shops.slug, currency: shops.currency })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  if (!shop) {
    return c.json({ error: 'shop_not_found' }, 404);
  }

  const result = await runInTransactionWithAudit(async (tx, audit) => {
    const orderNumber = await nextOrderNumber(tx, shop.id, shop.slug);

    const [order] = await tx
      .insert(orders)
      .values({
        shopId: shop.id,
        orderNumber,
        customerId: input.customerId ?? null,
        email: input.email ?? null,
        channel: input.channel,
        status: 'pending',
        financialStatus: 'pending',
        fulfillmentStatus: 'unfulfilled',
        currency: input.currency ?? shop.currency ?? 'EUR',
        subtotal: totals.subtotal,
        discountTotal: input.discountTotal ?? '0',
        shippingTotal: input.shippingTotal ?? '0',
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        billingAddress: input.billingAddress ?? null,
        shippingAddress: input.shippingAddress ?? null,
        note: input.note ?? null,
        placedAt: input.placed ? new Date() : null,
      })
      .returning();
    if (!order) throw new Error('order insert returned no row');

    const insertedItems = [];
    for (const { input: it, computed } of lines) {
      const [row] = await tx
        .insert(orderItems)
        .values({
          orderId: order.id,
          variantId: it.variantId ?? null,
          sku: it.sku ?? null,
          title: it.title ?? null,
          quantity: computed.quantity,
          unitPrice: computed.unitPrice,
          taxRate: computed.taxRate,
          taxAmount: computed.taxAmount,
          costPrice: computed.costPrice,
          lineTotal: computed.lineTotal,
        })
        .returning();
      if (!row) throw new Error('order_item insert returned no row');
      insertedItems.push(row);
    }

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'order',
      entityId: order.id,
      before: null,
      after: {
        id: order.id,
        orderNumber: order.orderNumber,
        shopId: order.shopId,
        grandTotal: order.grandTotal,
        itemCount: insertedItems.length,
      },
      ip,
    });

    return { order, insertedItems };
  });

  const margin = computeOrderMargin(lines.map((l) => l.computed));

  return c.json(
    {
      order: {
        ...toOrderCore(result.order),
        items: result.insertedItems.map((row, idx) => {
          const cl = lines[idx]?.computed;
          return toOrderItemDto(row, cl?.margin ?? null, cl?.marginPct ?? null);
        }),
        margin: margin.margin,
        marginPct: margin.marginPct,
      },
    },
    201,
  );
}
