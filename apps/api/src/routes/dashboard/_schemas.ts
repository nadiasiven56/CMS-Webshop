/**
 * Zod-validatieschemas voor de dashboard-module.
 *
 * Alle KPI-query-params zijn optioneel. `shop_id` weglaten = aggregeer over
 * ALLE shops. `from`/`to` zijn YYYY-MM-DD (zoals finance-routes). Datums
 * worden naar timestamptz-ranges gecast in de queries.
 */
import { z } from 'zod';

export const KpiQuerySchema = z.object({
  shop_id: z.string().uuid().optional(),
  channel: z.string().trim().min(1).max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type KpiQuery = z.infer<typeof KpiQuerySchema>;
