/**
 * Orders-routes — `/api/orders/*` + top-level `/api/returns/*`.
 *
 * Endpoints (alle achter requireAuth, admin):
 *   GET    /api/orders                      — list (shop_id/status/search/paginate)
 *   POST   /api/orders                      — create (genereert order_number, totalen, marge)
 *   GET    /api/orders/:id                  — detail (items+marge, payments, fulfillments, returns)
 *   PATCH  /api/orders/:id/status           — status-transitie (state-machine + audit)
 *   GET    /api/orders/:id/fulfillments     — list fulfillments
 *   POST   /api/orders/:id/fulfillments     — create fulfillment (+ tracking)
 *   GET    /api/orders/:id/payments         — list payments
 *   POST   /api/orders/:id/payments         — create payment
 *   GET    /api/orders/:id/returns          — list returns for order
 *   POST   /api/orders/:id/returns          — create RMA voor order
 *
 *   GET    /api/returns                     — RMA-board (filter shop/order/status)
 *   POST   /api/returns                     — create RMA (shopId of orderId verplicht)
 *   GET    /api/returns/:rid                — detail
 *   PATCH  /api/returns/:rid                — update status/refund
 *
 * Wired in routes/index.ts door Atlas (zie REGISTER.md).
 */
import { Hono } from 'hono';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { listOrders } from './list.js';
import { getOrder } from './get.js';
import { createOrder } from './create.js';
import { updateOrderStatus } from './status.js';
import { listFulfillments, createFulfillment } from './fulfillments.js';
import { listPayments, createPayment } from './payments.js';
import {
  createReturnForOrder,
  listReturnsForOrder,
  listReturns,
  getReturn,
  createReturn,
  updateReturn,
} from './returns.js';

// ─── /api/orders/* ───────────────────────────────────────────
export const ordersRoutes = new Hono<{ Variables: AuthVariables }>();
ordersRoutes.use('*', requireAuth);

ordersRoutes.get('/', listOrders);
ordersRoutes.post('/', createOrder);
ordersRoutes.get('/:id', getOrder);
ordersRoutes.patch('/:id/status', updateOrderStatus);

ordersRoutes.get('/:id/fulfillments', listFulfillments);
ordersRoutes.post('/:id/fulfillments', createFulfillment);

ordersRoutes.get('/:id/payments', listPayments);
ordersRoutes.post('/:id/payments', createPayment);

ordersRoutes.get('/:id/returns', listReturnsForOrder);
ordersRoutes.post('/:id/returns', createReturnForOrder);

// ─── /api/returns/* ──────────────────────────────────────────
export const returnsRoutes = new Hono<{ Variables: AuthVariables }>();
returnsRoutes.use('*', requireAuth);

returnsRoutes.get('/', listReturns);
returnsRoutes.post('/', createReturn);
returnsRoutes.get('/:rid', getReturn);
returnsRoutes.patch('/:rid', updateReturn);
