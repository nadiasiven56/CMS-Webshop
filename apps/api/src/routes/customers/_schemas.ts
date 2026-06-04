/**
 * Zod-schemas voor de customers-module (body + query validatie).
 */
import { z } from 'zod';

// ─── Customers ────────────────────────────────────────────────

export const CustomerListQuerySchema = z.object({
  shopId: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const emailField = z.string().trim().toLowerCase().email().max(320);
const tagsField = z.array(z.string().trim().min(1)).max(50);

export const CustomerCreateSchema = z.object({
  shopId: z.string().uuid(),
  email: emailField,
  firstName: z.string().trim().max(200).nullish(),
  lastName: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(64).nullish(),
  company: z.string().trim().max(200).nullish(),
  vatNumber: z.string().trim().max(64).nullish(),
  acceptsMarketing: z.boolean().optional(),
  tags: tagsField.optional(),
  notes: z.string().max(10_000).nullish(),
});

export const CustomerUpdateSchema = z
  .object({
    email: emailField.optional(),
    firstName: z.string().trim().max(200).nullish(),
    lastName: z.string().trim().max(200).nullish(),
    phone: z.string().trim().max(64).nullish(),
    company: z.string().trim().max(200).nullish(),
    vatNumber: z.string().trim().max(64).nullish(),
    acceptsMarketing: z.boolean().optional(),
    tags: tagsField.optional(),
    notes: z.string().max(10_000).nullish(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: 'at least one field required',
  });

// ─── Addresses ────────────────────────────────────────────────

export const AddressTypeSchema = z.enum(['billing', 'shipping']);

export const AddressCreateSchema = z.object({
  type: AddressTypeSchema,
  isDefault: z.boolean().optional(),
  name: z.string().trim().max(200).nullish(),
  line1: z.string().trim().max(300).nullish(),
  line2: z.string().trim().max(300).nullish(),
  postcode: z.string().trim().max(32).nullish(),
  city: z.string().trim().max(200).nullish(),
  province: z.string().trim().max(200).nullish(),
  country: z.string().trim().length(2).toUpperCase().nullish(), // ISO-2
  phone: z.string().trim().max(64).nullish(),
});

export const AddressUpdateSchema = z
  .object({
    type: AddressTypeSchema.optional(),
    isDefault: z.boolean().optional(),
    name: z.string().trim().max(200).nullish(),
    line1: z.string().trim().max(300).nullish(),
    line2: z.string().trim().max(300).nullish(),
    postcode: z.string().trim().max(32).nullish(),
    city: z.string().trim().max(200).nullish(),
    province: z.string().trim().max(200).nullish(),
    country: z.string().trim().length(2).toUpperCase().nullish(),
    phone: z.string().trim().max(64).nullish(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: 'at least one field required',
  });

export const OrdersHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
