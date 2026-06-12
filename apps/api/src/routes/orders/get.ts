/**
 * GET /api/orders/:id — volledige order met items (incl. marge),
 * payments, fulfillments, returns en customer-snapshot.
 *
 * Marge per regel wordt afgeleid uit `order_items.cost_price`. De order-totaal
 * marge staat in `margin` (som van regel-marges, regels zonder cost genegeerd).
 */
import type { Context } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { orders } from '../../db/schema/orders.js';
import { orderItems } from '../../db/schema/order-items.js';
import { orderPayments } from '../../db/schema/order-payments.js';
import { orderFulfillments } from '../../db/schema/order-fulfillments.js';
import { returns } from '../../db/schema/returns.js';
import { returnItems } from '../../db/schema/return-items.js';
import { customers } from '../../db/schema/customers.js';
import { canAccessShop } from '../../lib/access.js';
import { isUuid } from '../products/_validate.js';
import {
  toOrderCore,
  toOrderItemDto,
  toOrderPaymentDto,
  toOrderFulfillmentDto,
  toReturnDto,
} from './_serialize.js';
import { computeLine, computeOrderMargin } from '../../domain/orders/order-math.js';

export async function getOrder(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) {
    return c.json({ error: 'not_found' }, 404);
  }
  // Multi-user: shop niet toegankelijk → zelfde 404 (geen existence-leak).
  if (!(await canAccessShop(c.get('user'), order.shopId))) {
    return c.json({ error: 'not_found' }, 404);
  }

  const [itemRows, paymentRows, fulfillmentRows, returnRows] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, id)),
    db
      .select()
      .from(orderPayments)
      .where(eq(orderPayments.orderId, id))
      .orderBy(desc(orderPayments.createdAt)),
    db
      .select()
      .from(orderFulfillments)
      .where(eq(orderFulfillments.orderId, id))
      .orderBy(desc(orderFulfillments.createdAt)),
    db.select().from(returns).where(eq(returns.orderId, id)).orderBy(desc(returns.createdAt)),
  ]);

  // customer-snapshot
  let customer = null;
  if (order.customerId) {
    const [cu] = await db
      .select({
        id: customers.id,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        phone: customers.phone,
        company: customers.company,
      })
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .limit(1);
    if (cu) customer = cu;
  }

  // regels + marge per regel
  const computedLines = itemRows.map((i) => {
    const computed = computeLine({
      quantity: i.quantity,
      unitPrice: i.unitPrice ?? '0',
      taxRate: i.taxRate,
      costPrice: i.costPrice,
    });
    return {
      dto: toOrderItemDto(
        i,
        computed.margin,
        computed.marginPct,
      ),
      computed,
    };
  });
  const margin = computeOrderMargin(computedLines.map((l) => l.computed));

  // return-items per return
  const returnIds = returnRows.map((r) => r.id);
  const returnsWithItems = await Promise.all(
    returnRows.map(async (r) => {
      const ris = returnIds.length
        ? await db.select().from(returnItems).where(eq(returnItems.returnId, r.id))
        : [];
      return toReturnDto(r, ris);
    }),
  );

  return c.json({
    order: {
      ...toOrderCore(order),
      customer,
      items: computedLines.map((l) => l.dto),
      payments: paymentRows.map(toOrderPaymentDto),
      fulfillments: fulfillmentRows.map(toOrderFulfillmentDto),
      returns: returnsWithItems,
      margin: margin.margin,
      marginPct: margin.marginPct,
    },
  });
}
