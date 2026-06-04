/**
 * Product-API contract — single source of truth voor admin <-> api.
 *
 * Conventie: zod-schema = contract; TypeScript-types via `z.infer<>`.
 * Bedragen blijven `string` (Money) over de wire (Postgres numeric → string).
 */
import { z } from 'zod';

// ─── Enums ───────────────────────────────────────────────────

export const TaxClassSchema = z.enum(['standard', 'reduced', 'zero', 'exempt']);
export type TaxClass = z.infer<typeof TaxClassSchema>;

export const ProductStatusSchema = z.enum(['draft', 'active', 'archived']);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

// Money = numeric(12,4) in DB → string over wire. Validate: digits[.digits]
const MoneyStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, 'must be decimal string with up to 4 decimals');

// ─── Variant schemas ─────────────────────────────────────────

export const VariantCreateInputSchema = z.object({
  sku: z.string().min(1).max(120),
  price: MoneyStringSchema,
  compareAtPrice: MoneyStringSchema.nullable().optional(),
  costPrice: MoneyStringSchema.nullable().optional(),
  weightG: z.number().int().nonnegative().nullable().optional(),
  lengthMm: z.number().int().nonnegative().nullable().optional(),
  widthMm: z.number().int().nonnegative().nullable().optional(),
  heightMm: z.number().int().nonnegative().nullable().optional(),
  barcode: z.string().nullable().optional(),
  selectedOptions: z.record(z.string(), z.string()).optional().default({}),
  position: z.number().int().nonnegative().optional().default(0),
  taxable: z.boolean().optional().default(true),
  taxClass: TaxClassSchema.optional().default('standard'),
});
export type VariantCreateInput = z.infer<typeof VariantCreateInputSchema>;

export const VariantUpdateInputSchema = VariantCreateInputSchema.partial().extend({
  active: z.boolean().optional(),
});
export type VariantUpdateInput = z.infer<typeof VariantUpdateInputSchema>;

export const VariantDtoSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  sku: z.string(),
  price: z.string(), // Money
  compareAtPrice: z.string().nullable(),
  costPrice: z.string().nullable(),
  weightG: z.number().nullable(),
  lengthMm: z.number().nullable(),
  widthMm: z.number().nullable(),
  heightMm: z.number().nullable(),
  barcode: z.string().nullable(),
  selectedOptions: z.record(z.string(), z.string()),
  position: z.number(),
  taxable: z.boolean(),
  taxClass: TaxClassSchema,
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VariantDto = z.infer<typeof VariantDtoSchema>;

// ─── Product-option schemas ──────────────────────────────────

export const ProductOptionInputSchema = z.object({
  name: z.string().min(1).max(80),
  position: z.number().int().nonnegative().optional().default(0),
  values: z.array(z.string().min(1)).default([]),
});
export type ProductOptionInput = z.infer<typeof ProductOptionInputSchema>;

export const ProductOptionDtoSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  name: z.string(),
  position: z.number(),
  values: z.array(
    z.object({
      id: z.string().uuid(),
      value: z.string(),
      position: z.number(),
    }),
  ),
});
export type ProductOptionDto = z.infer<typeof ProductOptionDtoSchema>;

// ─── Product-image schema (read-only voor product-agent) ─────

export const ProductImageDtoSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  url: z.string(),
  alt: z.string().nullable(),
  position: z.number(),
  createdAt: z.string(),
});
export type ProductImageDto = z.infer<typeof ProductImageDtoSchema>;

// ─── Product schemas ─────────────────────────────────────────

export const ProductCoreSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  descriptionHtml: z.string().nullable(),
  vendor: z.string().nullable(),
  productType: z.string().nullable(),
  status: ProductStatusSchema,
  tags: z.array(z.string()),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProductCore = z.infer<typeof ProductCoreSchema>;

export const ProductCreateInputSchema = z.object({
  title: z.string().min(1).max(200),
  // slug optioneel — backend genereert uit title als afwezig
  slug: z.string().min(1).max(200).optional(),
  descriptionHtml: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  productType: z.string().nullable().optional(),
  status: ProductStatusSchema.optional().default('draft'),
  tags: z.array(z.string()).optional().default([]),
  options: z.array(ProductOptionInputSchema).optional().default([]),
  variants: z.array(VariantCreateInputSchema).optional().default([]),
});
export type ProductCreateInput = z.infer<typeof ProductCreateInputSchema>;

export const ProductUpdateInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(200).optional(),
  descriptionHtml: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  productType: z.string().nullable().optional(),
  status: ProductStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  publishedAt: z.string().nullable().optional(),
});
export type ProductUpdateInput = z.infer<typeof ProductUpdateInputSchema>;

// ─── List / detail responses ─────────────────────────────────

export const ProductListItemSchema = ProductCoreSchema.extend({
  variantCount: z.number(),
  primaryImageUrl: z.string().nullable(),
});
export type ProductListItem = z.infer<typeof ProductListItemSchema>;

export const ListProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: ProductStatusSchema.optional(),
  search: z.string().optional(),
});
export type ListProductsQuery = z.infer<typeof ListProductsQuerySchema>;

export const ListProductsResponseSchema = z.object({
  items: z.array(ProductListItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListProductsResponse = z.infer<typeof ListProductsResponseSchema>;

export const ProductWithRelationsSchema = ProductCoreSchema.extend({
  variants: z.array(VariantDtoSchema),
  options: z.array(ProductOptionDtoSchema),
  images: z.array(ProductImageDtoSchema),
});
export type ProductWithRelations = z.infer<typeof ProductWithRelationsSchema>;

export const ProductResponseSchema = z.object({ product: ProductWithRelationsSchema });
export type ProductResponse = z.infer<typeof ProductResponseSchema>;

export const VariantResponseSchema = z.object({ variant: VariantDtoSchema });
export type VariantResponse = z.infer<typeof VariantResponseSchema>;
