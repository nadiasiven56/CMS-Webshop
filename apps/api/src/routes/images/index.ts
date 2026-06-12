/**
 * /api/images — image upload + lifecycle.
 *
 * Endpoints (alle write-paden achter requireAuth):
 *   POST   /api/images                              upload (multipart)
 *   DELETE /api/images/:id                          hard-delete (DB + storage)
 *   PATCH  /api/images/:id                          alt + position update
 *   POST   /api/products/:productId/images/reorder  bulk-reorder (mounted op
 *                                                   /api/products via aparte
 *                                                   subrouter — zie REGISTER.md
 *                                                   waarom dit hier mee gaat)
 *
 * Storage gaat via `getStorage()` (zie lib/storage/). DB-mutaties via
 * Drizzle-transaction zodat fouten een halve insert achterlaten.
 *
 * Multipart-parser: Hono's `c.req.parseBody({ all: true })` levert File-objecten
 * (Web-API). We lezen ze in-memory (max 10 MB / file = OK voor V1).
 *
 * Multi-user: role 'user' mag alleen images van EIGEN producten uploaden,
 * wijzigen, verwijderen en reorderen (andermans product = 404); losse uploads
 * zonder product_id zijn voor role 'user' verboden (403). Admin: alles.
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { productImages } from '../../db/schema/product-images.js';
import { products } from '../../db/schema/products.js';
import { auditLog } from '../../db/schema/audit-log.js';
import { getStorage, makeImageKey, isAllowedMime, type AllowedImageMime } from '../../lib/storage/index.js';
import {
  MAX_IMAGE_BYTES,
  statusForValidationError,
  validateImageBuffer,
} from '../../domain/images/validate.js';
import { registerProductImage } from '../../domain/images/register-product-image.js';
import { isAdmin, canAccessProduct } from '../../lib/access.js';
import type { AuthUser } from '../../lib/auth.js';

export const imageRoutes = new Hono<{ Variables: AuthVariables }>();

// ─── helpers ─────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

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

/**
 * Hono parseBody() returns:
 *   - single field key → File
 *   - multiple fields with same key (using `{ all: true }`) → File[]
 *   - field 'file' OR 'file[]' OR multiple 'file' entries — we accept all.
 */
function collectFiles(body: Record<string, unknown>): File[] {
  const out: File[] = [];
  const candidate = body['file'] ?? body['file[]'] ?? body['files'] ?? body['files[]'];
  if (Array.isArray(candidate)) {
    for (const v of candidate) if (isFileLike(v)) out.push(v);
  } else if (isFileLike(candidate)) {
    out.push(candidate);
  }
  return out;
}

/**
 * Multi-user: mag deze user de images van dit product beheren?
 * Admin altijd (zonder extra query); role 'user' alleen voor eigen producten.
 */
async function canAccessImageProduct(user: AuthUser, productId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const [p] = await db
    .select({ ownerUserId: products.ownerUserId })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return Boolean(p && canAccessProduct(user, { ownerUserId: p.ownerUserId ?? null }));
}

// ─── POST /api/images — upload (multipart) ───────────────────
imageRoutes.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? null;

  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody({ all: true });
  } catch (err) {
    logger.warn({ err }, 'multipart parse failed');
    return c.json({ error: 'invalid_multipart', message: 'Kon multipart-body niet lezen.' }, 400);
  }

  const files = collectFiles(body);
  if (files.length === 0) {
    return c.json({ error: 'no_file', message: "Geen 'file' veld in multipart-body." }, 400);
  }

  // product_id is optioneel; als gegeven moet hij UUID zijn EN bestaan.
  // Multi-user: non-admins mogen alleen aan EIGEN producten koppelen
  // (andermans product = 404, zelfde shape als onbestaand) en mogen geen
  // losse uploads doen (geen product_id → 403).
  const productIdRaw = (body['product_id'] ?? body['productId']) as string | undefined;
  let productId: string | null = null;
  if (productIdRaw && typeof productIdRaw === 'string' && productIdRaw.length > 0) {
    const parsed = uuidSchema.safeParse(productIdRaw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_product_id', message: 'product_id moet UUID zijn.' }, 400);
    }
    const [p] = await db
      .select({ id: products.id, ownerUserId: products.ownerUserId })
      .from(products)
      .where(eq(products.id, parsed.data))
      .limit(1);
    if (!p || !canAccessProduct(user, { ownerUserId: p.ownerUserId ?? null })) {
      return c.json({ error: 'product_not_found', message: 'Geen product met dit id.' }, 404);
    }
    productId = parsed.data;
  } else if (!isAdmin(user)) {
    return c.json(
      { error: 'forbidden', message: 'Losse uploads (zonder product_id) zijn alleen voor admins.' },
      403,
    );
  }

  const altRaw = body['alt'];
  const alt = typeof altRaw === 'string' && altRaw.length > 0 ? altRaw.slice(0, 500) : null;

  // Validate ELKE file vooraf zodat we niet half doorgaan.
  for (const f of files) {
    const v = validateImageBuffer({ contentType: f.type, size: f.size });
    if (!v.ok) {
      return c.json({ error: v.code, message: v.message, filename: f.name }, statusForValidationError(v));
    }
  }

  const storage = getStorage();
  const results: Array<{
    id: string | null;
    url: string;
    key: string;
    alt: string | null;
    position: number | null;
    size: number;
  }> = [];

  // Per file: schrijf naar storage. Als productId gegeven: ook DB-row + audit.
  for (const f of files) {
    const mime = f.type as AllowedImageMime; // already validated
    if (!isAllowedMime(mime)) continue; // belt-and-braces; niet bereikbaar
    const buf = Buffer.from(await f.arrayBuffer());
    const key = makeImageKey({
      productId,
      originalName: f.name,
      uuid: randomUUID(),
      mime,
    });

    let putRes;
    try {
      putRes = await storage.put(key, buf, mime);
    } catch (err) {
      logger.error({ err, key }, 'storage.put failed');
      // Cleanup wat we al schreven binnen deze request:
      for (const prev of results) {
        try {
          await storage.delete(prev.key);
        } catch {
          /* swallow — best effort */
        }
      }
      return c.json({ error: 'storage_error', message: 'Kon bestand niet opslaan.' }, 500);
    }

    if (productId) {
      try {
        const row = await registerProductImage(db, {
          productId,
          url: putRes.url,
          alt,
          actorId: user.id,
          ip,
        });
        results.push({
          id: row.id,
          url: row.url,
          key: putRes.key,
          alt: row.alt,
          position: row.position,
          size: putRes.size,
        });
      } catch (err) {
        logger.error({ err, key }, 'register-product-image insert failed; rolling back storage');
        try {
          await storage.delete(putRes.key);
        } catch {
          /* swallow */
        }
        return c.json({ error: 'db_error', message: 'Kon image-row niet opslaan.' }, 500);
      }
    } else {
      // Losse upload — geen DB-row, alleen URL teruggeven.
      results.push({
        id: null,
        url: putRes.url,
        key: putRes.key,
        alt,
        position: null,
        size: putRes.size,
      });
    }
  }

  return c.json({ images: results }, 201);
});

// ─── PATCH /api/images/:id — alt + position update ───────────
const patchSchema = z.object({
  alt: z.string().max(500).nullable().optional(),
  position: z.number().int().nonnegative().optional(),
});

imageRoutes.patch('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? null;

  const id = c.req.param('id');
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) {
    return c.json({ error: 'invalid_id', message: 'id moet UUID zijn.' }, 400);
  }

  const json = await c.req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }

  if (parsed.data.alt === undefined && parsed.data.position === undefined) {
    return c.json({ error: 'no_changes', message: 'Geef alt en/of position mee.' }, 400);
  }

  const [before] = await db.select().from(productImages).where(eq(productImages.id, idParsed.data)).limit(1);
  // Multi-user: image van andermans product = 404 (zelfde shape als onbestaand).
  if (!before || !(await canAccessImageProduct(user, before.productId))) {
    return c.json({ error: 'not_found' }, 404);
  }

  const updateValues: Partial<typeof productImages.$inferInsert> = {};
  if (parsed.data.alt !== undefined) updateValues.alt = parsed.data.alt;
  if (parsed.data.position !== undefined) updateValues.position = parsed.data.position;

  const [after] = await db
    .update(productImages)
    .set(updateValues)
    .where(eq(productImages.id, idParsed.data))
    .returning();

  await db.insert(auditLog).values({
    actorType: 'user',
    actorId: user.id,
    action: 'update',
    entityType: 'product_image',
    entityId: idParsed.data,
    before: before as never,
    after: after as never,
    ip,
  });

  return c.json({ image: after });
});

// ─── DELETE /api/images/:id ──────────────────────────────────
//
// V1: hard-delete. Volgorde:
//   1) DB-row verwijderen (single source of truth)
//   2) storage.delete() — bij failure log warning, maar 200 retourneren
//      (DB is consistent; verloren file is acceptable orphan).
imageRoutes.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? null;

  const id = c.req.param('id');
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) {
    return c.json({ error: 'invalid_id' }, 400);
  }

  const [row] = await db.select().from(productImages).where(eq(productImages.id, idParsed.data)).limit(1);
  // Multi-user: image van andermans product = 404 (zelfde shape als onbestaand).
  if (!row || !(await canAccessImageProduct(user, row.productId))) {
    return c.json({ error: 'not_found' }, 404);
  }

  // Delete DB row first.
  await db.delete(productImages).where(eq(productImages.id, idParsed.data));

  // Audit BEFORE attempting file-delete (we want the audit-row even if file-delete fails).
  await db.insert(auditLog).values({
    actorType: 'user',
    actorId: user.id,
    action: 'delete',
    entityType: 'product_image',
    entityId: idParsed.data,
    before: row as never,
    after: null as never,
    ip,
  });

  // Best-effort delete on disk. We stored `url`; we need the storage-key.
  // V1: derive from URL by stripping the public-base + url-prefix.
  const storage = getStorage();
  const key = deriveKeyFromUrl(row.url);
  if (key) {
    try {
      await storage.delete(key);
    } catch (err) {
      logger.warn({ err, key, id: row.id }, 'storage.delete failed (DB row removed; file is now orphan)');
    }
  } else {
    logger.warn({ url: row.url, id: row.id }, 'could not derive storage-key from url; file not deleted');
  }

  return c.json({ ok: true });
});

// ─── POST /api/images/:productId/reorder ─────────────────────
//
// Body: `[{ id, position }]` — bulk-update positions in 1 transaction.
// Mounted onder /api/images om geen overlap met product-agent's
// /api/products te veroorzaken (zie REGISTER.md voor pad-keuze).
const reorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        position: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(100),
});

imageRoutes.post('/reorder/:productId', requireAuth, async (c) => {
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? null;

  const productIdRaw = c.req.param('productId');
  const productIdParsed = uuidSchema.safeParse(productIdRaw);
  if (!productIdParsed.success) {
    return c.json({ error: 'invalid_product_id' }, 400);
  }

  // Multi-user: reorder mag alleen op eigen producten (admin: alles).
  if (!(await canAccessImageProduct(user, productIdParsed.data))) {
    return c.json({ error: 'product_not_found', message: 'Geen product met dit id.' }, 404);
  }

  const json = await c.req.json().catch(() => null);
  const parsed = reorderSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }

  const ids = parsed.data.items.map((i) => i.id);

  // Verify alle ids horen bij dit product (anders = client-bug of malicious).
  const found = await db
    .select({ id: productImages.id, productId: productImages.productId })
    .from(productImages)
    .where(inArray(productImages.id, ids));

  if (found.length !== ids.length) {
    return c.json({ error: 'images_not_found', message: 'Niet alle ids bestaan.' }, 404);
  }
  for (const f of found) {
    if (f.productId !== productIdParsed.data) {
      return c.json(
        { error: 'image_not_in_product', message: `Image ${f.id} hoort niet bij dit product.` },
        400,
      );
    }
  }

  // Drizzle has no built-in `transaction()` exposed via postgres-js client?
  // Yes it does — db.transaction(...). Each row gets its own UPDATE.
  await db.transaction(async (tx) => {
    for (const item of parsed.data.items) {
      await tx
        .update(productImages)
        .set({ position: item.position })
        .where(eq(productImages.id, item.id));
    }
    await tx.insert(auditLog).values({
      actorType: 'user',
      actorId: user.id,
      action: 'update',
      entityType: 'product_image',
      entityId: productIdParsed.data,
      before: null as never,
      after: parsed.data.items as never,
      ip,
    });
  });

  const after = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productIdParsed.data));

  return c.json({ images: after });
});

// ─── url → storage-key derivation ────────────────────────────
//
// Local-driver bouwt URL als `<publicBase><urlPrefix>/<key>`. Voor delete
// hebben we de `key` terug nodig. Heuristiek: strip alles tot en met `/storage/`.
// Dit is local-driver-specifiek; V2 (S3) bewaren we de key apart in DB
// (kolom `storage_key` toevoegen aan product_images-schema). V1: simpel.
function deriveKeyFromUrl(url: string): string | null {
  const marker = '/storage/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export { deriveKeyFromUrl as _deriveKeyFromUrl };
