/**
 * Route-aggregator. Alle subrouters wirden hier in 1 Hono-app onder /api.
 *
 * Extensie-pattern voor parallel feature-agents (zie INTEGRATION.md):
 *   1. Maak `src/routes/<feature>/index.ts` die `export const <feature>Routes`
 *      = new Hono<...>() exporteert.
 *   2. Voeg HIER 1 regel toe: `apiRoutes.route('/<feature>', <feature>Routes);`
 *   3. Doe dat in een NIEUWE commit/diff zodat conflicten zichtbaar zijn.
 *
 * GEEN feature-agent mag andere agent-routes editen.
 */
import { Hono } from 'hono';
import { authRoutes } from './auth.js';
import { requireAdmin, type AuthVariables } from '../middleware/auth.js';

// Feature-agent imports (Fase 1 ronde 2 — geactiveerd door finalizer):
import { productRoutes } from './products/index.js';
import { stockRoutes } from './stock/index.js';
import { movementsRoutes } from './movements/index.js';
import { imageRoutes } from './images/index.js';

// Wave 1 — CMS + commerce backend-modules (gewired door Atlas/finalizer):
import { shopsRoutes } from './shops/index.js';
import { cmsRoutes } from './cms/index.js';
import { ordersRoutes, returnsRoutes } from './orders/index.js';
import { customersRoutes } from './customers/index.js';
import { purchasingRoutes } from './purchasing/index.js';
import { financeRoutes } from './finance/index.js';
import { storefrontRoutes } from './storefront/index.js';

// Wave B — multi-channel command center (gewired door finalizer):
import { channelRoutes } from './channels/index.js';
import { dashboardRoutes } from './dashboard/index.js';
import { locationsRoutes } from './locations/index.js';
import { adminRoutes } from './admin/index.js';
import { paymentsRoutes } from './payments/index.js';

// Round 3 — integrations (gewired door finalizer):
import { shippingRoutes } from './shipping/index.js';
import { accountingRoutes } from './accounting/index.js';
import { notificationRoutes } from './notifications/index.js';
import { discountRoutes } from './discounts/index.js';
import { feedsRoutes } from './feeds/index.js';
import { analyticsRoutes } from './analytics/index.js';
import { webhookRoutes } from './webhooks/index.js';
import { reviewRoutes } from './reviews/index.js';
import { auditRoutes } from './audit/index.js';

export const apiRoutes = new Hono<{ Variables: AuthVariables }>();

// ─── Multi-user lock-down ────────────────────────────────────
// Tenants (role 'user') zien alleen hun eigen shops/producten/orders; die
// scoping zit in de route-handlers zelf (lib/access.ts). De modules hieronder
// zijn platform-breed (geconsolideerde finance, marketplace-kanalen, magazijn-
// locaties, gebruikersbeheer, integraties) en blijven ADMIN-ONLY.
// LET OP: /payments, /storefront en /feeds/public horen hier NIET bij (publiek).
const ADMIN_ONLY = [
  'purchasing',
  'finance',
  'channels',
  'locations',
  'admin',
  'shipping',
  'accounting',
  'notifications',
  'analytics',
  'webhooks',
  'reviews',
  'audit',
] as const;
for (const seg of ADMIN_ONLY) {
  apiRoutes.use(`/${seg}`, requireAdmin);
  apiRoutes.use(`/${seg}/*`, requireAdmin);
}

apiRoutes.route('/auth', authRoutes);

// ─── Feature-agent registration slot ─────────────────────────
// product-agent (Fase 1, ronde 2):
apiRoutes.route('/products', productRoutes);

// stock-agent (Fase 1, ronde 2):
apiRoutes.route('/stock', stockRoutes);
apiRoutes.route('/movements', movementsRoutes);

// image-agent (Fase 1, ronde 2):
apiRoutes.route('/images', imageRoutes);

// ─── Wave 1 — CMS + commerce (multi-shop) ────────────────────
apiRoutes.route('/shops', shopsRoutes);
apiRoutes.route('/cms', cmsRoutes);
apiRoutes.route('/orders', ordersRoutes);
apiRoutes.route('/returns', returnsRoutes);
apiRoutes.route('/customers', customersRoutes);
apiRoutes.route('/purchasing', purchasingRoutes);
apiRoutes.route('/finance', financeRoutes);
apiRoutes.route('/storefront/v1', storefrontRoutes);

// ─── Wave B — channels + dashboard + locations + admin ───────
apiRoutes.route('/channels', channelRoutes);
apiRoutes.route('/dashboard', dashboardRoutes);
apiRoutes.route('/locations', locationsRoutes);
apiRoutes.route('/admin', adminRoutes);
apiRoutes.route('/payments', paymentsRoutes); // PUBLIC (Mollie webhook) — geen requireAuth

// ─── Round 3 — integrations ──────────────────────────────────
apiRoutes.route('/shipping', shippingRoutes);
apiRoutes.route('/accounting', accountingRoutes);
apiRoutes.route('/notifications', notificationRoutes);
apiRoutes.route('/discounts', discountRoutes);
apiRoutes.route('/feeds', feedsRoutes); // /feeds/public/* is auth-free (parent-Hono)
apiRoutes.route('/analytics', analyticsRoutes);
apiRoutes.route('/webhooks', webhookRoutes);
apiRoutes.route('/reviews', reviewRoutes);
apiRoutes.route('/audit', auditRoutes);
// ─────────────────────────────────────────────────────────────

// Future fasen — placeholder routes (komen pas in latere fasen)
// Fase 2: apiRoutes.route('/storefront/v1', storefrontRoutes);
// Fase 3: apiRoutes.route('/channels', channelRoutes);
// Fase 4: apiRoutes.route('/finance', financeRoutes);
// Fase 5: apiRoutes.route('/orders', orderRoutes);
//         apiRoutes.route('/shipments', shipmentRoutes);
