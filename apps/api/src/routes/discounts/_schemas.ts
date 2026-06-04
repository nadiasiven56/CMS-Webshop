/**
 * Zod-validatieschemas voor de discounts-module (`/api/discounts`).
 *
 * Conventies (zie shops/_schemas.ts + channels/_schemas.ts):
 *   - Geld (`value`, `minSubtotal`, `subtotal`, `shipping`) als decimal-STRING
 *     (Money, numeric(12,4)). Nooit number in/uit.
 *   - Datums als ISO-8601-string → gecoerced naar Date.
 *   - `type` is een enum; `value` is verplicht behalve voor free_shipping (we
 *     defaulten dan naar '0' in de route).
 */
import { z } from 'zod';

/** Discount-types. */
export const DISCOUNT_TYPES = ['percentage', 'fixed', 'free_shipping'] as const;
export const DiscountTypeSchema = z.enum(DISCOUNT_TYPES);

/** numeric(12,4)-string. Accepteert '12', '12.5', '12.5000', etc. (geen negatief). */
const moneyString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, 'must be a non-negative decimal string with max 4 decimals');

/** ISO-datetime-string → Date. */
const isoDate = z
  .string()
  .trim()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

/** Code: 1..64 tekens, letters/cijfers/koppel-/underscore. Wordt UPPERCASE genormaliseerd. */
const codeString = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, 'code may only contain letters, digits, . _ -');

// ─── Create ──────────────────────────────────────────────────

export const DiscountCreateSchema = z
  .object({
    code: codeString,
    type: DiscountTypeSchema,
    value: moneyString.optional(),
    shopId: z.string().uuid().nullable().optional(),
    currency: z.string().trim().length(3).optional(),
    minSubtotal: moneyString.nullable().optional(),
    startsAt: isoDate.nullable().optional(),
    endsAt: isoDate.nullable().optional(),
    maxRedemptions: z.coerce.number().int().min(1).nullable().optional(),
    maxPerCustomer: z.coerce.number().int().min(1).nullable().optional(),
    active: z.boolean().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    // value is verplicht voor percentage/fixed (free_shipping negeert value).
    if (v.type !== 'free_shipping' && (v.value === undefined || v.value === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'value is required for percentage/fixed discounts',
      });
    }
    if (v.startsAt && v.endsAt && v.startsAt.getTime() >= v.endsAt.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'endsAt must be after startsAt',
      });
    }
  });

// ─── Patch ───────────────────────────────────────────────────

export const DiscountPatchSchema = z
  .object({
    code: codeString.optional(),
    type: DiscountTypeSchema.optional(),
    value: moneyString.optional(),
    shopId: z.string().uuid().nullable().optional(),
    currency: z.string().trim().length(3).optional(),
    minSubtotal: moneyString.nullable().optional(),
    startsAt: isoDate.nullable().optional(),
    endsAt: isoDate.nullable().optional(),
    maxRedemptions: z.coerce.number().int().min(1).nullable().optional(),
    maxPerCustomer: z.coerce.number().int().min(1).nullable().optional(),
    active: z.boolean().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field required',
  });

// ─── List query ──────────────────────────────────────────────

export const ListQuerySchema = z.object({
  shop_id: z.string().uuid().optional(),
  active: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  q: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/** Pagination-only query (redemptions-list). */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ─── Validate (admin-preview) ────────────────────────────────

export const ValidateSchema = z.object({
  code: codeString,
  shop_id: z.string().uuid().nullable().optional(),
  subtotal: moneyString,
  currency: z.string().trim().length(3).optional(),
  customer_email: z.string().trim().email().optional(),
  shipping: moneyString.optional(),
});

export type DiscountCreateInput = z.infer<typeof DiscountCreateSchema>;
export type DiscountPatchInput = z.infer<typeof DiscountPatchSchema>;
export type ListQueryInput = z.infer<typeof ListQuerySchema>;
export type ValidateInput = z.infer<typeof ValidateSchema>;
