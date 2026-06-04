/**
 * Customer-routes — `/api/customers/*`
 *
 * Endpoints (alles achter requireAuth, shop-scoped via shopId-filter/-body):
 *   GET    /                          — list + filter (shopId/search) + paginate
 *   POST   /                          — create (UNIQUE(shop_id,email))
 *   GET    /:id                       — detail + adressen
 *   PATCH  /:id                       — partial update
 *   DELETE /:id                       — hard-delete (addresses cascade, orders set null)
 *   GET    /:id/addresses             — adres-lijst
 *   POST   /:id/addresses             — adres-create (billing|shipping, is_default)
 *   PATCH  /:id/addresses/:addressId  — adres-update
 *   DELETE /:id/addresses/:addressId  — adres-delete
 *   GET    /:id/orders                — read-only order-historie (select op orders)
 *
 * Wired in routes/index.ts door finalizer (zie REGISTER.md).
 */
import { Hono } from 'hono';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { listCustomers } from './list.js';
import { getCustomer } from './get.js';
import { createCustomer } from './create.js';
import { updateCustomer } from './update.js';
import { deleteCustomer } from './delete.js';
import {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} from './addresses.js';
import { listCustomerOrders } from './orders-history.js';

export const customersRoutes = new Hono<{ Variables: AuthVariables }>();

// Alle admin-routes achter auth.
customersRoutes.use('*', requireAuth);

// Customers CRUD
customersRoutes.get('/', listCustomers);
customersRoutes.post('/', createCustomer);
customersRoutes.get('/:id', getCustomer);
customersRoutes.patch('/:id', updateCustomer);
customersRoutes.delete('/:id', deleteCustomer);

// Geneste adressen
customersRoutes.get('/:id/addresses', listAddresses);
customersRoutes.post('/:id/addresses', createAddress);
customersRoutes.patch('/:id/addresses/:addressId', updateAddress);
customersRoutes.delete('/:id/addresses/:addressId', deleteAddress);

// Read-only order-historie
customersRoutes.get('/:id/orders', listCustomerOrders);
