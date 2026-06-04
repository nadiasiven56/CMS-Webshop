/**
 * Validation helpers voor image-upload.
 *
 * Centraliseert content-type + size-check zodat routes en eventuele
 * BullMQ-jobs (V2: thumbnail-resize) dezelfde regels gebruiken.
 */
import { isAllowedMime, type AllowedImageMime } from '../../lib/storage/sanitize.js';

/** Hard cap: 10 MB per image V1. Operator override via env mogelijk in V2. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type ValidationError =
  | { ok: false; code: 'unsupported_media_type'; message: string }
  | { ok: false; code: 'payload_too_large'; message: string }
  | { ok: false; code: 'empty_file'; message: string };

export type ValidationResult =
  | { ok: true; mime: AllowedImageMime; size: number }
  | ValidationError;

export function validateImageBuffer(input: {
  contentType: string;
  size: number;
}): ValidationResult {
  if (!isAllowedMime(input.contentType)) {
    return {
      ok: false,
      code: 'unsupported_media_type',
      message: `Content-type '${input.contentType}' niet toegestaan. Verwacht: image/jpeg, image/png, image/webp.`,
    };
  }
  if (input.size <= 0) {
    return {
      ok: false,
      code: 'empty_file',
      message: 'Bestand is leeg.',
    };
  }
  if (input.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      code: 'payload_too_large',
      message: `Bestand is groter dan ${MAX_IMAGE_BYTES} bytes (${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)} MB).`,
    };
  }
  return { ok: true, mime: input.contentType, size: input.size };
}

/** HTTP status-code voor een ValidationError. */
export function statusForValidationError(err: ValidationError): 400 | 413 | 415 {
  switch (err.code) {
    case 'unsupported_media_type':
      return 415;
    case 'payload_too_large':
      return 413;
    case 'empty_file':
      return 400;
  }
}
