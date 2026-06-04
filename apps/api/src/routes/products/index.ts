/**
 * Product-routes — `/api/products/*`
 *
 * Endpoints:
 *   GET    /                    — paginate + filter (status/search)
 *   POST   /                    — create product (incl varianten + options)
 *   GET    /:id                 — full product met varianten/options/images
 *   PATCH  /:id                 — partial update
 *   DELETE /:id                 — soft-archive (status='archived')
 *   POST   /:id/variants        — add variant
 *   PATCH  /:id/variants/:vid   — update variant
 *   DELETE /:id/variants/:vid   — soft-deactivate variant (active=false)
 *
 * Auth: write-routes achter requireAuth.
 * Idempotency: global middleware op /api/* — gebruik Idempotency-Key header.
 *
 * Wired in routes/index.ts door finalizer (zie REGISTER.md).
 */
import { Hono } from 'hono';
import type { AuthVariables } from '../../middleware/auth.js';
import { listProducts } from './list.js';
import { createProduct } from './create.js';
import { getProduct } from './get.js';
import { updateProduct } from './update.js';
import { deleteProduct } from './delete.js';
import {
  addVariant,
  updateVariantHandler,
  deleteVariantHandler,
} from './variants.js';
import { requireAuth } from '../../middleware/auth.js';

export const productRoutes = new Hono<{ Variables: AuthVariables }>();

// Reads — geen auth in V1 (admin-shell guard al via _app), maar we kunnen
// kiezen om alles te beschermen. Foundation-pattern: `requireAuth` op
// alles wat niet expliciet public is. Volg dat.
productRoutes.get('/', requireAuth, listProducts);
productRoutes.get('/:id', requireAuth, getProduct);

// Writes — requireAuth verplicht.
productRoutes.post('/', requireAuth, createProduct);
productRoutes.patch('/:id', requireAuth, updateProduct);
productRoutes.delete('/:id', requireAuth, deleteProduct);

productRoutes.post('/:id/variants', requireAuth, addVariant);
productRoutes.patch('/:id/variants/:variantId', requireAuth, updateVariantHandler);
productRoutes.delete('/:id/variants/:variantId', requireAuth, deleteVariantHandler);
