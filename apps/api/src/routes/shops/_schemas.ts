/**
 * Zod-validatieschemas voor de shops-module.
 *
 * Geld (price_override) als string-pattern (Money-conventie). numeric(12,4) →
 * we accepteren een decimal-string en laten de driver/DB casten.
 */
import { z } from 'zod';

/** numeric(12,4)-string. Accepteert '12', '12.5', '12.5000', etc. */
const moneyString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,4})?$/, 'must be a decimal string with max 4 decimals');

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case');

const brandingSchema = z
  .object({
    logoUrl: z.string().trim().max(2048).optional(),
    primaryColor: z.string().trim().max(32).optional(),
    accentColor: z.string().trim().max(32).optional(),
    font: z.string().trim().max(128).optional(),
    theme: z.string().trim().max(64).optional(),
  })
  .passthrough();

const vatConfigSchema = z
  .object({
    priceIncludesVat: z.boolean().optional(),
    defaultCountry: z.string().trim().length(2).optional(),
    oss: z.boolean().optional(),
  })
  .passthrough();

const shopStatusSchema = z.enum(['active', 'draft', 'paused']);

export const ShopCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(255).optional().nullable(),
  locale: z.string().trim().min(2).max(16).optional(),
  currency: z.string().trim().length(3).optional(),
  status: shopStatusSchema.optional(),
  branding: brandingSchema.optional(),
  vatConfig: vatConfigSchema.optional(),
  defaultLocationId: z.string().uuid().optional().nullable(),
  supportEmail: z.string().trim().email().max(255).optional().nullable(),
});

export const ShopUpdateSchema = z
  .object({
    slug: slugSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    domain: z.string().trim().min(1).max(255).nullable().optional(),
    locale: z.string().trim().min(2).max(16).optional(),
    currency: z.string().trim().length(3).optional(),
    status: shopStatusSchema.optional(),
    branding: brandingSchema.optional(),
    vatConfig: vatConfigSchema.optional(),
    defaultLocationId: z.string().uuid().nullable().optional(),
    supportEmail: z.string().trim().email().max(255).nullable().optional(),
    // Wave-H A4 — betaalprovider per shop (Mollie). apiKey wordt encrypted opgeslagen.
    paymentProvider: z.enum(['mollie']).nullable().optional(),
    paymentCredentials: z
      .object({ apiKey: z.string().trim().min(1).max(255) })
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field required',
  });

export const ShopListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: shopStatusSchema.optional(),
  search: z.string().trim().min(1).optional(),
});

/** Body voor PUT /api/shops/:id/products/:productId (publicatie-toggle). */
export const ShopProductUpsertSchema = z
  .object({
    published: z.boolean().optional(),
    priceOverride: moneyString.nullable().optional(),
    position: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one of published, priceOverride, position required',
  });

export const ShopProductsQuerySchema = z.object({
  publishedOnly: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export type ShopCreateInput = z.infer<typeof ShopCreateSchema>;
export type ShopUpdateInput = z.infer<typeof ShopUpdateSchema>;
export type ShopProductUpsertInput = z.infer<typeof ShopProductUpsertSchema>;
