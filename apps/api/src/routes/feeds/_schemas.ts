/**
 * Zod-validatieschemas voor de feeds/marketing-module (`/api/feeds`).
 *
 * Conventies (zie channels/shops `_schemas.ts`):
 *   - Upsert-bodies zijn per-shop (shop_id apart als query/param meegegeven).
 *   - Analytics-ids zijn nullable strings — de operator vult ze later in. We
 *     valideren lengte/vorm licht (geen harde provider-format-eis, zodat nieuwe
 *     id-formats niet breken), maar trimmen en cap-pen wel.
 */
import { z } from 'zod';
import { FEED_CHANNELS } from '../../db/schema/marketing.js';

/** Lege string → null (de operator kan een veld leegmaken). */
const nullableId = z
  .string()
  .trim()
  .max(256)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

export const FeedChannelSchema = z.enum(FEED_CHANNELS);

// ─── Storefront-analytics upsert ─────────────────────────────
//
// PUT /api/feeds/analytics?shop_id=<uuid>. Alle velden optioneel/nullable →
// partial upsert. Lege strings worden null (veld leegmaken).

export const AnalyticsUpsertSchema = z
  .object({
    ga4MeasurementId: nullableId,
    metaPixelId: nullableId,
    googleAdsId: nullableId,
    googleAdsConversionLabel: nullableId,
    // customHeadHtml mag groter zijn (snippets). Lege string → null.
    customHeadHtml: z
      .string()
      .max(16384)
      .transform((v) => (v.trim().length === 0 ? null : v))
      .nullable()
      .optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field required',
  });

// ─── Feed-config upsert ──────────────────────────────────────
//
// PUT /api/feeds/configs?shop_id=<uuid>. channel is verplicht (bepaalt de
// unique-row per shop+channel). Rest optioneel → partial upsert.

export const FeedConfigUpsertSchema = z.object({
  channel: FeedChannelSchema,
  enabled: z.boolean().optional(),
  includeOutOfStock: z.boolean().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// ─── Query: shop_id ──────────────────────────────────────────

export const ShopIdQuerySchema = z.object({
  shop_id: z.string().uuid(),
});

export type AnalyticsUpsertInput = z.infer<typeof AnalyticsUpsertSchema>;
export type FeedConfigUpsertInput = z.infer<typeof FeedConfigUpsertSchema>;
