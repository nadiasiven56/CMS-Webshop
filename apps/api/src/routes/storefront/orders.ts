/**
 * Publieke order-/betaalstatus voor de storefront-terugkeerpagina.
 *
 *   GET /orders/:orderNumber/status
 *
 * Na een PSP-redirect (Mollie) keert de koper terug op /checkout/return; die
 * pagina pollt dit endpoint tot de webhook de betaling heeft bevestigd. De
 * webhook is server-to-server en kan vóór of ná de browser-redirect arriveren,
 * vandaar het pollen.
 *
 * Shop-scoped: alleen de order van de actieve shop. Lekt geen klant-/orderdetails
 * — enkel het order-nummer, een afgeleide betaal-state en het bedrag.
 *
 * Betaal-state-afleiding (de webhook laat order.financial_status bij een mislukte
 * betaling op 'pending_payment' staan en zet alleen order_payments.status='failed'):
 *   - paid    : order.financial_status='paid'  OF een payment-row is 'paid'
 *   - failed  : order.status='cancelled'        OF een payment-row is 'failed'
 *   - pending : anders (betaling nog onderweg / nog niet bevestigd)
 */
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { orders } from '../../db/schema/orders.js';
import { orderPayments } from '../../db/schema/order-payments.js';
import type { Shop } from '../../db/schema/index.js';

export async function getOrderStatus(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const orderNumber = c.req.param('orderNumber')?.trim();
  if (!orderNumber) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      financialStatus: orders.financialStatus,
      currency: orders.currency,
      grandTotal: orders.grandTotal,
    })
    .from(orders)
    .where(and(eq(orders.shopId, shop.id), eq(orders.orderNumber, orderNumber)))
    .limit(1);

  if (!order) {
    return c.json({ error: 'order_not_found' }, 404);
  }

  const payments = await db
    .select({ status: orderPayments.status })
    .from(orderPayments)
    .where(eq(orderPayments.orderId, order.id));

  const isPaid =
    order.financialStatus === 'paid' || payments.some((p) => p.status === 'paid');
  const isFailed =
    !isPaid &&
    (order.status === 'cancelled' || payments.some((p) => p.status === 'failed'));
  const state: 'paid' | 'failed' | 'pending' = isPaid
    ? 'paid'
    : isFailed
      ? 'failed'
      : 'pending';

  return c.json({
    order: {
      orderNumber: order.orderNumber,
      state,
      financialStatus: order.financialStatus,
      currency: order.currency,
      grandTotal: order.grandTotal,
    },
  });
}
