/**
 * Zod-validatieschemas voor de locations-module.
 *
 * `code` = unieke korte sleutel ('main', 'wh-nl'). `type` = warehouse |
 * dropship | virtual | store | transit (open text in DB; we valideren een
 * praktische set + staan onbekende toe via passthrough enum-fallback).
 */
import { z } from 'zod';

const addressSchema = z
  .object({
    line1: z.string().trim().max(255).optional(),
    line2: z.string().trim().max(255).optional(),
    postcode: z.string().trim().max(32).optional(),
    city: z.string().trim().max(128).optional(),
    country: z.string().trim().length(2).optional(), // ISO-2
  })
  .passthrough();

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i, 'code must be alphanumeric with - or _');

export const LocationCreateSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(32).optional(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
  address: addressSchema.nullable().optional(),
  active: z.boolean().optional(),
});

export const LocationUpdateSchema = z
  .object({
    code: codeSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    type: z.string().trim().min(1).max(32).optional(),
    priority: z.number().int().min(0).max(1_000_000).optional(),
    address: addressSchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field required',
  });

export const LocationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  active: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  search: z.string().trim().min(1).optional(),
});

export type LocationCreateInput = z.infer<typeof LocationCreateSchema>;
export type LocationUpdateInput = z.infer<typeof LocationUpdateSchema>;
