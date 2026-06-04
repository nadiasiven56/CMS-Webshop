/**
 * @webshop-crm/shared — types & schemas gedeeld tussen API en Admin (en
 * later storefront-clients).
 *
 * Conventie: zod-schema's zijn de single source of truth. TypeScript-types
 * worden afgeleid met `z.infer<>`.
 */

export * as Auth from './api/auth.js';
export * as Products from './api/products.js';
export * as Money from './types/money.js';
export * as Images from './api/images.js';
