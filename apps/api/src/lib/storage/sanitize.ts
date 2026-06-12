/**
 * Allowed MIME types for image uploads
 */
export type AllowedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const ALLOWED_MIMES = new Set<string>(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Check if a MIME type is an allowed image type
 */
export function isAllowedMime(mime: string): mime is AllowedImageMime {
  return ALLOWED_MIMES.has(mime);
}

/**
 * Sanitize a filename stem: strip de extensie, NFKD-accenten weg, lowercase,
 * special chars → dashes (collapsed), max 50 tekens. '../../etc/passwd' wordt
 * 'etc-passwd' (path-traversal kan nooit overleven).
 */
export function sanitizeFilenameStem(name: string): string {
  return name
    .replace(/\.[^./\\]+$/, '') // extensie eraf (laatste .xyz zonder padscheiders)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining accents weg (U+0300–U+036F)
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/** Extensie per toegestane mime, fallback op de bestandsnaam. */
function extensionFor(originalName: string, mime?: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    default: return originalName.split('.').pop()?.toLowerCase() || 'bin';
  }
}

/** Publieke mime→extensie mapping (zonder bestandsnaam-fallback). */
export function extensionForMime(mime: string): string {
  return extensionFor('', mime);
}

/**
 * Bouw een canonical storage-key voor een product-image.
 *   makeImageKey({ productId, originalName, uuid, mime })
 *   → "images/products/<productId>/<uuid>-<stem>.<ext>"  (met product)
 *   → "images/loose/<uuid>-<stem>.<ext>"                 (losse upload)
 */
export function makeImageKey(input: {
  productId: string | null;
  originalName: string;
  uuid: string;
  mime?: string;
}): string {
  const stem = sanitizeFilenameStem(input.originalName.replace(/\.[^.]+$/, '')) || 'image';
  const ext = extensionFor(input.originalName, input.mime);
  const scope = input.productId ? `products/${input.productId}` : 'loose';
  return `images/${scope}/${input.uuid}-${stem}.${ext}`;
}
