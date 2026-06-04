/**
 * Slug- en storage-key helpers voor de CMS-module.
 *
 * Zelfde slugify-logica als domain/products/slugify (bewust gedupliceerd om
 * folder-strikt te blijven — de CMS-module mag niet leunen op product-domein).
 */

/** title → URL-safe slug. Pure deterministisch. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Sanitize een upload-filename naar een veilige stem (zonder extensie).
 * Spiegelt lib/storage/sanitize.sanitizeFilenameStem maar generiek (geen
 * image-MIME-restrictie) zodat we ook pdf/svg/etc kunnen opslaan.
 */
export function sanitizeStem(filename: string): string {
  const base = filename.replace(/\.[^./\\]*$/, '');
  const noAccents = base.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return noAccents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** Pak de (lowercase, alfanumerieke) extensie uit een filename, max 8 chars. */
export function extensionOf(filename: string, mime?: string): string {
  const m = filename.match(/\.([^./\\]+)$/);
  if (m && m[1]) {
    const ext = m[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ext.length > 0 && ext.length <= 8) return ext;
  }
  // Fallback uit mime (image/png → png, application/pdf → pdf)
  if (mime) {
    const sub = mime.split('/')[1];
    if (sub) {
      const ext = sub.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (ext.length > 0 && ext.length <= 8) return ext;
    }
  }
  return 'bin';
}

/**
 * Bouw een canonical storage-key voor een media-upload.
 *   makeMediaKey({ shopId, folder, originalName, uuid, mime })
 *   → "media/<shopId|global>/<folder>/<uuid>-<stem>.<ext>"
 */
export function makeMediaKey(input: {
  shopId: string | null;
  folder: string;
  originalName: string;
  uuid: string;
  mime?: string;
}): string {
  const stem = sanitizeStem(input.originalName) || 'file';
  const ext = extensionOf(input.originalName, input.mime);
  const scope = input.shopId ?? 'global';
  const folder = sanitizeStem(input.folder) || 'uploads';
  return `media/${scope}/${folder}/${input.uuid}-${stem}.${ext}`;
}
