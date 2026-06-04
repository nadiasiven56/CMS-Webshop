/**
 * Image-API contract — single source of truth voor admin <-> api.
 *
 * Conventie: zod-schema = contract; TypeScript-types via `z.infer<>`.
 *
 * Server-routes wonen in `apps/api/src/routes/images/` (image-agent).
 * Admin-component `ImageUploader` consumeert deze types.
 */
import { z } from 'zod';

// ─── Single image (DB-row shape) ────────────────────────────

export const ProductImageSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  url: z.string().url(),
  alt: z.string().nullable(),
  position: z.number().int().nonnegative(),
  createdAt: z.string().optional(),
});
export type ProductImage = z.infer<typeof ProductImageSchema>;

// ─── Upload-response (POST /api/images) ────────────────────

/**
 * Een upload-respons row. Bij `productId !== null` is dit een gewone DB-row;
 * bij `productId === null` (losse upload) zijn `id` en `position` null.
 */
export const ImageUploadRowSchema = z.object({
  id: z.string().uuid().nullable(),
  url: z.string().url(),
  alt: z.string().nullable(),
  position: z.number().int().nonnegative().nullable(),
  size: z.number().int().nonnegative().optional(),
  key: z.string().optional(),
});
export type ImageUploadRow = z.infer<typeof ImageUploadRowSchema>;

export const ImageUploadResponse = z.object({
  images: z.array(ImageUploadRowSchema),
});
export type ImageUpload = z.infer<typeof ImageUploadResponse>;

// ─── PATCH /api/images/:id ─────────────────────────────────

export const ImagePatchInputSchema = z
  .object({
    alt: z.string().max(500).nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .refine(
    (v) => v.alt !== undefined || v.position !== undefined,
    { message: 'Provide alt and/or position' },
  );
export type ImagePatchInput = z.infer<typeof ImagePatchInputSchema>;

export const ImagePatchResponseSchema = z.object({
  image: ProductImageSchema,
});
export type ImagePatchResponse = z.infer<typeof ImagePatchResponseSchema>;

// ─── POST /api/images/reorder/:productId ───────────────────

export const ImageReorderItemSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().nonnegative(),
});
export type ImageReorderItem = z.infer<typeof ImageReorderItemSchema>;

export const ImageReorderInputSchema = z.object({
  items: z.array(ImageReorderItemSchema).min(1).max(100),
});
export type ImageReorderInput = z.infer<typeof ImageReorderInputSchema>;

export const ImageReorderResponseSchema = z.object({
  images: z.array(ProductImageSchema),
});
export type ImageReorderResponse = z.infer<typeof ImageReorderResponseSchema>;

// ─── Constants (mirror van backend) ────────────────────────

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageAllowedMime = (typeof IMAGE_ALLOWED_MIME)[number];
