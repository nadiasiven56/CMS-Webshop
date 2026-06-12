/**
 * Media-library — `/api/cms/media`.
 *
 * Upload via bestaande lib/storage LocalDriver (zoals image-agent). `shop_id`
 * is nullable → NULL = globaal (gedeeld over alle shops). List/delete.
 *
 *   GET    /api/cms/media[?shop=<ref>&folder=&scope=shop|global|all&limit=&offset=]
 *   POST   /api/cms/media        (multipart: file[, shop=, folder=, alt=]) OF
 *                                json { url, filename, ... } om bestaande te registreren
 *   PATCH  /api/cms/media/:id    (alt/folder)
 *   DELETE /api/cms/media/:id    (DB-row + best-effort storage-delete)
 *
 * MIME is hier ruimer dan de product-images (we staan ook svg/pdf toe), maar
 * we begrenzen op een allowlist + max-size voor veiligheid.
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, desc, eq, isNull, or, count } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { cmsMedia } from '../../db/schema/index.js';
import { auditLog } from '../../db/schema/audit-log.js';
import type { AuthVariables } from '../../middleware/auth.js';
import { getStorage } from '../../lib/storage/index.js';
import { canAccessShop, isAdmin } from '../../lib/access.js';
import { isUuid, resolveShopId } from './_validate.js';
import { invalid } from './_errors.js';
import { makeMediaKey } from './_slug.js';
import { toMediaDto } from './_serialize.js';

export const mediaRoutes = new Hono<{ Variables: AuthVariables }>();

const MAX_MEDIA_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MEDIA_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
  'application/pdf',
]);

const listQuery = z.object({
  folder: z.string().trim().min(1).optional(),
  scope: z.enum(['shop', 'global', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const registerBody = z.object({
  shopId: z.string().nullable().optional(),
  url: z.string().trim().min(1),
  filename: z.string().trim().min(1),
  mime: z.string().nullable().optional(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  width: z.number().int().nonnegative().nullable().optional(),
  height: z.number().int().nonnegative().nullable().optional(),
  alt: z.string().nullable().optional(),
  folder: z.string().trim().min(1).default('uploads'),
});

const patchBody = z.object({
  alt: z.string().nullable().optional(),
  folder: z.string().trim().min(1).optional(),
});

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? null;

function isFileLike(v: unknown): v is File {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as File).arrayBuffer === 'function' &&
    typeof (v as File).type === 'string' &&
    typeof (v as File).name === 'string' &&
    typeof (v as File).size === 'number'
  );
}

// ─── LIST ────────────────────────────────────────────────────
mediaRoutes.get('/', async (c) => {
  const user = c.get('user');
  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  const { folder, scope, limit, offset } = parsed.data;

  // shop is optioneel: zonder shop → alleen globaal (shop_id IS NULL).
  // Multi-user: globale media is voor iedereen leesbaar (gedeelde assets);
  // shop-media alleen voor admin/members (resolveShopId checkt membership).
  const shopRef = c.req.query('shop') ?? c.req.header('x-shop-id');
  let shopId: string | null = null;
  if (shopRef) {
    shopId = await resolveShopId(shopRef, user);
    if (!shopId) return c.json({ error: 'shop_not_found', message: 'Onbekende shop.' }, 404);
  }

  const conds = [];
  if (folder) conds.push(eq(cmsMedia.folder, folder));
  if (scope === 'global') {
    conds.push(isNull(cmsMedia.shopId));
  } else if (scope === 'shop') {
    if (!shopId) return c.json({ error: 'shop_required', message: 'scope=shop vereist ?shop=.' }, 400);
    conds.push(eq(cmsMedia.shopId, shopId));
  } else {
    // 'all': shop-eigen + globaal als shop gegeven; anders alleen globaal.
    if (shopId) {
      // (shop_id = shopId OR shop_id IS NULL)
      conds.push(orShopOrGlobal(shopId));
    } else {
      conds.push(isNull(cmsMedia.shopId));
    }
  }

  const where = conds.length > 0 ? and(...conds) : undefined;

  const baseQuery = db.select().from(cmsMedia);
  const rows = await (where ? baseQuery.where(where) : baseQuery)
    .orderBy(desc(cmsMedia.createdAt))
    .limit(limit)
    .offset(offset);

  const totalQuery = db.select({ c: count() }).from(cmsMedia);
  const [{ c: total } = { c: 0 }] = await (where ? totalQuery.where(where) : totalQuery);

  return c.json({ items: rows.map(toMediaDto), total: Number(total), limit, offset });
});

// helper voor (shop_id = x OR shop_id IS NULL)
function orShopOrGlobal(shopId: string) {
  return or(eq(cmsMedia.shopId, shopId), isNull(cmsMedia.shopId))!;
}

// ─── POST — upload (multipart) OF register (json) ────────────
mediaRoutes.post('/', async (c) => {
  const user = c.get('user');
  const contentType = c.req.header('content-type') ?? '';

  // JSON-pad: registreer een bestaande URL (bv. al via /api/images geupload).
  if (contentType.includes('application/json')) {
    const body = await c.req.json().catch(() => null);
    const parsed = registerBody.safeParse(body);
    if (!parsed.success) return invalid(c, parsed.error.flatten());
    const input = parsed.data;

    let shopId: string | null = null;
    if (input.shopId) {
      shopId = await resolveShopId(input.shopId, user);
      if (!shopId) return c.json({ error: 'shop_not_found' }, 404);
    }
    // Multi-user: alleen admin mag globale media (shop_id NULL) registreren.
    if (!shopId && !isAdmin(user)) {
      return c.json(
        { error: 'shop_required', message: 'Geef een eigen shop mee (shopId).' },
        400,
      );
    }

    const [row] = await db
      .insert(cmsMedia)
      .values({
        shopId,
        url: input.url,
        filename: input.filename,
        mime: input.mime ?? null,
        sizeBytes: input.sizeBytes ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        alt: input.alt ?? null,
        folder: input.folder,
      })
      .returning();
    await writeAudit(user.id, 'create', row!.id, { shopId, url: row!.url }, ip(c));
    return c.json({ media: toMediaDto(row!) }, 201);
  }

  // Multipart-pad: echte upload.
  let parsedBody: Record<string, unknown>;
  try {
    parsedBody = await c.req.parseBody({ all: true });
  } catch (err) {
    logger.warn({ err }, 'cms media multipart parse failed');
    return c.json({ error: 'invalid_multipart', message: 'Kon multipart-body niet lezen.' }, 400);
  }

  const candidate = parsedBody['file'] ?? parsedBody['files'];
  const file = Array.isArray(candidate) ? candidate.find(isFileLike) : candidate;
  if (!isFileLike(file)) {
    return c.json({ error: 'no_file', message: "Geen 'file' veld in multipart-body." }, 400);
  }

  if (file.size > MAX_MEDIA_BYTES) {
    return c.json({ error: 'file_too_large', message: `Max ${MAX_MEDIA_BYTES} bytes.` }, 413);
  }
  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_MEDIA_MIME.has(mime)) {
    return c.json({ error: 'unsupported_mime', message: `MIME '${mime}' niet toegestaan.` }, 415);
  }

  // shop optioneel: zonder shop → globaal.
  const shopRef =
    (parsedBody['shop'] as string | undefined) ??
    c.req.query('shop') ??
    c.req.header('x-shop-id');
  let shopId: string | null = null;
  if (shopRef && typeof shopRef === 'string') {
    shopId = await resolveShopId(shopRef, user);
    if (!shopId) return c.json({ error: 'shop_not_found' }, 404);
  }
  // Multi-user: alleen admin mag globale media (shop_id NULL) uploaden.
  if (!shopId && !isAdmin(user)) {
    return c.json(
      { error: 'shop_required', message: 'Geef een eigen shop mee (shop=).' },
      400,
    );
  }

  const folderRaw = (parsedBody['folder'] as string | undefined) ?? 'uploads';
  const folder = folderRaw && typeof folderRaw === 'string' ? folderRaw.slice(0, 60) : 'uploads';
  const altRaw = parsedBody['alt'];
  const alt = typeof altRaw === 'string' && altRaw.length > 0 ? altRaw.slice(0, 500) : null;

  const storage = getStorage();
  const key = makeMediaKey({
    shopId,
    folder,
    originalName: file.name,
    uuid: randomUUID(),
    mime,
  });
  const buf = Buffer.from(await file.arrayBuffer());

  let putRes;
  try {
    putRes = await storage.put(key, buf, mime);
  } catch (err) {
    logger.error({ err, key }, 'cms media storage.put failed');
    return c.json({ error: 'storage_error', message: 'Kon bestand niet opslaan.' }, 500);
  }

  let row;
  try {
    [row] = await db
      .insert(cmsMedia)
      .values({
        shopId,
        url: putRes.url,
        filename: file.name.slice(0, 255),
        mime,
        sizeBytes: putRes.size,
        width: null,
        height: null,
        alt,
        folder,
      })
      .returning();
  } catch (err) {
    logger.error({ err, key }, 'cms media db insert failed; rolling back storage');
    try {
      await storage.delete(putRes.key);
    } catch {
      /* swallow */
    }
    return c.json({ error: 'db_error', message: 'Kon media-row niet opslaan.' }, 500);
  }

  await writeAudit(user.id, 'create', row!.id, { shopId, url: row!.url }, ip(c));
  return c.json({ media: toMediaDto(row!) }, 201);
});

// ─── PATCH — alt / folder ────────────────────────────────────
mediaRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = patchBody.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error.flatten());
  if (parsed.data.alt === undefined && parsed.data.folder === undefined) {
    return c.json({ error: 'no_changes', message: 'Geef alt en/of folder mee.' }, 400);
  }

  const [existing] = await db.select().from(cmsMedia).where(eq(cmsMedia.id, id)).limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  // Multi-user: globale media (shop_id NULL) is read-only voor non-admin;
  // shop-media alleen muteerbaar door admin/members (anders 404, geen leak).
  if (!isAdmin(user)) {
    if (existing.shopId === null) {
      return c.json({ error: 'forbidden', message: 'Globale media is read-only.' }, 403);
    }
    if (!(await canAccessShop(user, existing.shopId))) {
      return c.json({ error: 'not_found' }, 404);
    }
  }

  const patch: Partial<typeof cmsMedia.$inferInsert> = {};
  if (parsed.data.alt !== undefined) patch.alt = parsed.data.alt;
  if (parsed.data.folder !== undefined) patch.folder = parsed.data.folder;

  const [after] = await db.update(cmsMedia).set(patch).where(eq(cmsMedia.id, id)).returning();
  await writeAudit(user.id, 'update', id, { alt: after?.alt, folder: after?.folder }, ip(c));
  return c.json({ media: toMediaDto(after!) });
});

// ─── DELETE — DB-row + best-effort storage ───────────────────
mediaRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const user = c.get('user');

  const [row] = await db.select().from(cmsMedia).where(eq(cmsMedia.id, id)).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);

  // Multi-user: globale media (shop_id NULL) is read-only voor non-admin;
  // shop-media alleen verwijderbaar door admin/members (anders 404, geen leak).
  if (!isAdmin(user)) {
    if (row.shopId === null) {
      return c.json({ error: 'forbidden', message: 'Globale media is read-only.' }, 403);
    }
    if (!(await canAccessShop(user, row.shopId))) {
      return c.json({ error: 'not_found' }, 404);
    }
  }

  await db.delete(cmsMedia).where(eq(cmsMedia.id, id));
  await writeAudit(user.id, 'delete', id, { url: row.url, filename: row.filename }, ip(c));

  // best-effort storage-delete (zelfde key-derivatie als image-agent: strip tot /storage/).
  const key = deriveKeyFromUrl(row.url);
  if (key) {
    try {
      await getStorage().delete(key);
    } catch (err) {
      logger.warn({ err, key, id }, 'cms media storage.delete failed (orphan blijft over)');
    }
  }
  return c.json({ ok: true });
});

// ─── helpers ─────────────────────────────────────────────────
async function writeAudit(
  actorId: string,
  action: string,
  entityId: string,
  after: unknown,
  ipAddr: string | null,
): Promise<void> {
  await db.insert(auditLog).values({
    actorType: 'user',
    actorId,
    action,
    entityType: 'cms_media',
    entityId,
    before: null as never,
    after: after as never,
    ip: ipAddr,
  });
}

function deriveKeyFromUrl(url: string): string | null {
  const marker = '/storage/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export { deriveKeyFromUrl as _deriveKeyFromUrl };
