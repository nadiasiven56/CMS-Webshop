/**
 * Drizzle schema-index voor Webshop-CRM.
 *
 * Conventie: 1 file per tabel + re-export hier. Drizzle-kit gebruikt deze
 * file om migrations te genereren (`drizzle.config.ts` schema-pad).
 *
 * Fase 1 (foundation) — currently exported:
 *   auth: users, sessions, api_tokens
 *   locations
 *   catalog: products, product_options, product_option_values, product_images, variants
 *   inventory: inventory_items, inventory_levels, inventory_movements, inventory_reservations
 *   cross-cutting: audit_log, idempotency_keys
 *
 * Fase 2-5 (komen later, NIET in V1-foundation):
 *   - suppliers, purchase_orders, purchase_order_items     (Fase 2/3 - inkoop)
 *   - customers                                            (Fase 2 - storefront)
 *   - orders, order_items, btw_records, fulfillments,
 *     fulfillment_items, shipments, refunds                (Fase 2/3 - orders)
 *   - ledger_entries                                       (Fase 4 - financieel)
 *   - channels, channel_products, channel_listings         (Fase 3 - marketplaces)
 *   - accounting_connections, accounting_exports           (Fase 4 - boekhouding)
 *
 * Wanneer een feature-agent zijn schema toevoegt, voegt die agent 1 regel
 * `export * from './<file>.js'` toe en voert `pnpm db:generate` om een
 * additieve migration te creeren. NOOIT bestaande migrations editen.
 */

// ─── Auth ─────────────────────────────────────────────────────
export * from './users.js';
export * from './sessions.js';
export * from './api-tokens.js';

// ─── Locations ────────────────────────────────────────────────
export * from './locations.js';

// ─── Catalog ──────────────────────────────────────────────────
export * from './products.js';
export * from './product-options.js';
export * from './product-option-values.js';
export * from './product-images.js';
export * from './variants.js';

// ─── Inventory ────────────────────────────────────────────────
export * from './inventory-items.js';
export * from './inventory-levels.js';
export * from './inventory-movements.js';
export * from './inventory-reservations.js';

// ─── Cross-cutting ────────────────────────────────────────────
export * from './audit-log.js';
export * from './idempotency-keys.js';

// ════════════════════════════════════════════════════════════════
// Fase 2 (0001_cms_commerce_finance) — multi-shop + CMS + commerce
// + purchasing + financieel + channels. Puur additief op de
// foundation hierboven.
// ════════════════════════════════════════════════════════════════

// ─── Multi-shop ───────────────────────────────────────────────
export * from './shops.js';
export * from './shop-products.js';

// ─── CMS ──────────────────────────────────────────────────────
export * from './cms-pages.js';
export * from './cms-blocks.js';
export * from './cms-menus.js';
export * from './cms-menu-items.js';
export * from './blog-posts.js';
export * from './cms-media.js';
export * from './cms-redirects.js';

// ─── Commerce ─────────────────────────────────────────────────
export * from './customers.js';
export * from './customer-addresses.js';
export * from './orders.js';
export * from './order-items.js';
export * from './order-payments.js';
export * from './order-fulfillments.js';
export * from './carts.js';
export * from './cart-items.js';
export * from './returns.js';
export * from './return-items.js';

// ─── Purchasing ───────────────────────────────────────────────
export * from './suppliers.js';
export * from './purchase-orders.js';
export * from './purchase-order-items.js';

// ─── Financieel ───────────────────────────────────────────────
export * from './vat-rates.js';
export * from './ledger-entries.js';
export * from './invoices.js';
export * from './payouts.js';
export * from './accounting-exports.js';

// ─── Channels ─────────────────────────────────────────────────
export * from './channels.js';
export * from './channel-products.js';
export * from './channel-orders.js';

// ════════════════════════════════════════════════════════════════
// Wave A2 (0002_webhooks) — outbound webhooks. Puur additief.
// ════════════════════════════════════════════════════════════════

// ─── Webhooks ─────────────────────────────────────────────────
export * from './webhooks.js';

// ════════════════════════════════════════════════════════════════
// Round 3 — integrations (0005..0011). Puur additief.
// ════════════════════════════════════════════════════════════════

// ─── Shipping / carriers ──────────────────────────────────────
export * from './shipping.js';

// ─── Boekhouding (accounting-sync) ────────────────────────────
export * from './accounting.js';

// ─── Notifications / e-mail ───────────────────────────────────
export * from './notifications.js';

// ─── Discounts / vouchers ─────────────────────────────────────
export * from './discounts.js';

// ─── Marketing (feeds + storefront-analytics) ─────────────────
export * from './marketing.js';

// ─── Webhook-deliveries (outbound delivery-log) ───────────────
export * from './webhook-deliveries.js';

// ─── Reviews (Kiyoh / Trustpilot / Google) ────────────────────
export * from './reviews.js';

// ════════════════════════════════════════════════════════════════
// Multi-user (0013_multi_user) — shop-membership. Puur additief.
// ════════════════════════════════════════════════════════════════
export * from './shop-members.js';
