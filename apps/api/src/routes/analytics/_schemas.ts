/**
 * Zod-validatieschemas voor de analytics-module (`/api/analytics/*`).
 *
 * Alle endpoints delen dezelfde basis-filters (shop_id / channel / from / to /
 * interval). `shop_id` weglaten = aggregeer over ALLE shops; `from`/`to` zijn
 * YYYY-MM-DD (consistent met dashboard/finance) en worden in de queries naar
 * timestamptz-ranges gecast. `interval` stuurt de date_trunc-granulariteit voor
 * de tijdreeks (default 'day').
 *
 * Per-endpoint schemas extenden de basis met hun eigen `limit`/`threshold`.
 */
import { z } from 'zod';

/** date_trunc-granulariteit voor de tijdreeks. */
export const IntervalSchema = z.enum(['day', 'week', 'month']);
export type Interval = z.infer<typeof IntervalSchema>;

/** YYYY-MM-DD (lokale dag-grens, net als dashboard/finance). */
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Gedeelde basis-query: shop/channel/date-range + interval. Elk endpoint
 * gebruikt (een superset van) deze velden zodat de filtering consistent is.
 */
export const BaseQuerySchema = z.object({
  shop_id: z.string().uuid().optional(),
  channel: z.string().trim().min(1).max(64).optional(),
  from: DateOnly.optional(),
  to: DateOnly.optional(),
  interval: IntervalSchema.default('day'),
});
export type BaseQuery = z.infer<typeof BaseQuerySchema>;

/** /sales-over-time — basis + interval (al in basis). */
export const SalesOverTimeQuerySchema = BaseQuerySchema;

/** /kpis — alleen het venster + shop/channel (interval ongebruikt maar toegestaan). */
export const KpisQuerySchema = BaseQuerySchema;

/** /channel-breakdown + /shop-breakdown — basis (interval ongebruikt). */
export const BreakdownQuerySchema = BaseQuerySchema;

/** /top-products?limit=10 */
export const TopProductsQuerySchema = BaseQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

/** /customers/top?limit=10 */
export const TopCustomersQuerySchema = BaseQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

/** /low-stock?threshold=5 — shop/channel niet relevant (voorraad is shop-overstijgend in V1). */
export const LowStockQuerySchema = z.object({
  shop_id: z.string().uuid().optional(),
  threshold: z.coerce.number().int().min(0).max(100000).default(5),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type LowStockQuery = z.infer<typeof LowStockQuerySchema>;
