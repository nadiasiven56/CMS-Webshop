/**
 * Allowed MIME types for image uploads
 */
export type AllowedImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'image/svg+xml';

const ALLOWED_MIMES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

/**
 * Check if a MIME type is an allowed image type
 */
export function isAllowedMime(mime: string): mime is AllowedImageMime {
  return ALLOWED_MIMES.has(mime);
}

/**
 * Sanitize a filename stem — remove special chars, lowercase, trim
 */
export function sanitizeFilenameStem(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

/**
 * Build a storage key for an image
 */
export function makeImageKey(productId: string, filename: string): string {
  const stem = sanitizeFilenameStem(filename.replace(/\.[^.]+$/, ''));
  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
  const timestamp = Date.now();
  return `products/${productId}/${stem}-${timestamp}.${ext}`;
}
