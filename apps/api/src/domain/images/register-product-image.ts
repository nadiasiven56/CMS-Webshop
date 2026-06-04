/**
 * register-product-image — schrijft een product_images-rij met auto-incremented
 * `position` (volgt achteraan een bestaande lijst). Wordt aangeroepen door de
 * /api/images-route na een succesvolle storage.put().
 *
 * Wordt in een transactie aangeroepen (bv. tijdens bulk-upload) zodat een
 * crash een halve batch achterlaat ipv inconsistentie.
 */
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../../lib/db.js';
import { productImages } from '../../db/schema/product-images.js';
import { auditLog } from '../../db/schema/audit-log.js';

export interface RegisterProductImageInput {
  productId: string;
  url: string;
  alt: string | null;
  /** Pas `position` expliciet door als niet auto-end-of-list. */
  position?: number;
  actorId: string;
  ip?: string | null;
}

export async function registerProductImage(
  client: DB,
  input: RegisterProductImageInput,
) {
  // Bepaal positie als niet meegegeven: max(position) + 1, default 0.
  let position = input.position;
  if (position === undefined) {
    const rows = await client
      .select({
        maxPos: sql<number>`COALESCE(MAX(${productImages.position}), -1)`,
      })
      .from(productImages)
      .where(eq(productImages.productId, input.productId));
    const maxPos = rows[0]?.maxPos;
    position = (maxPos ?? -1) + 1;
  }

  const [row] = await client
    .insert(productImages)
    .values({
      productId: input.productId,
      url: input.url,
      alt: input.alt,
      position,
    })
    .returning();

  if (!row) throw new Error('insert product_image returned no row');

  await client.insert(auditLog).values({
    actorType: 'user',
    actorId: input.actorId,
    action: 'create',
    entityType: 'product_image',
    entityId: row.id,
    after: row as never,
    ip: input.ip ?? null,
  });

  return row;
}
