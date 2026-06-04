/**
 * Zod-validatieschemas voor de channels-module (`/api/channels`).
 *
 * Conventies (zie shops/_schemas.ts):
 *   - Geld (price_override) als decimal-STRING (Money, numeric(12,4)).
 *   - Credentials worden NOOIT in een response gezet; deze schemas valideren
 *     alleen het *inkomende* credential-body per channel-type. De route
 *     encrypteert ze direct via channel-crypto.
 *   - `config` is een vrij jsonb-blob (own_webshop bindt hierin shopId/shopSlug).
 */
import { z } from 'zod';

/** Channel-types waarvoor een adapter bestaat. */
export const CHANNEL_TYPES = ['own_webshop', 'bol', 'amazon', 'gmc'] as const;
export const ChannelTypeSchema = z.enum(CHANNEL_TYPES);

/** Statussen die een channel kan hebben. */
export const CHANNEL_STATUSES = ['disconnected', 'connected', 'error'] as const;
export const ChannelStatusSchema = z.enum(CHANNEL_STATUSES);

/** numeric(12,4)-string. Accepteert '12', '12.5', '12.5000', etc. */
const moneyString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,4})?$/, 'must be a decimal string with max 4 decimals');

/** Vrij config-blob — own_webshop gebruikt shopId/shopSlug. Passthrough houdt
 *  extra channel-specifieke keys intact. */
const configSchema = z
  .object({
    shopId: z.string().uuid().optional(),
    shopSlug: z.string().trim().min(1).max(64).optional(),
  })
  .passthrough();

// ─── Create / Patch ──────────────────────────────────────────

export const ChannelCreateSchema = z.object({
  type: ChannelTypeSchema,
  name: z.string().trim().min(1).max(200),
  config: configSchema.optional(),
});

export const ChannelPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    config: configSchema.optional(),
    status: ChannelStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one of name, config, status required',
  });

// ─── Credentials (per type) ──────────────────────────────────
//
// PUT /:id/credentials valideert per channel-type. De route kiest het juiste
// schema op basis van de opgeslagen channel.type. own_webshop heeft geen
// externe credentials.

export const BolCredentialsSchema = z.object({
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().trim().min(1).max(2048),
});

export const AmazonCredentialsSchema = z.object({
  refreshToken: z.string().trim().min(1).max(4096),
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().trim().min(1).max(2048),
  sellerId: z.string().trim().min(1).max(255).optional(),
  marketplaceId: z.string().trim().min(1).max(64).optional(),
  region: z.enum(['eu', 'na', 'fe']).optional(),
});

export const GmcCredentialsSchema = z.object({
  merchantId: z.string().trim().min(1).max(64),
  serviceAccountJson: z.string().trim().min(1).max(16384),
});

/** Map channel-type → credentials-schema. own_webshop = geen creds. */
export const CREDENTIALS_SCHEMA_BY_TYPE: Record<
  (typeof CHANNEL_TYPES)[number],
  z.ZodTypeAny | null
> = {
  own_webshop: null,
  bol: BolCredentialsSchema,
  amazon: AmazonCredentialsSchema,
  gmc: GmcCredentialsSchema,
};

// ─── Products toggle ─────────────────────────────────────────

/** Body voor PUT /:id/products/:variantId (channel_products enable/disable +
 *  price-override). */
export const ChannelProductUpsertSchema = z
  .object({
    enabled: z.boolean().optional(),
    priceOverride: moneyString.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one of enabled, priceOverride required',
  });

// ─── List query ──────────────────────────────────────────────

export const ChannelListQuerySchema = z.object({
  type: ChannelTypeSchema.optional(),
  status: ChannelStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const ChannelProductsQuerySchema = z.object({
  enabledOnly: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export type ChannelCreateInput = z.infer<typeof ChannelCreateSchema>;
export type ChannelPatchInput = z.infer<typeof ChannelPatchSchema>;
export type ChannelProductUpsertInput = z.infer<typeof ChannelProductUpsertSchema>;
