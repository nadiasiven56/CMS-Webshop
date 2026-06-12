/**
 * DELETE /api/products/:id — soft-archive.
 *
 * Zet `status='archived'` (NIET hard-delete).
 *
 * 200 { product: { id, status: 'archived' } }
 * 404 not_found
 * 400 invalid_id
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { products } from '../../db/schema/index.js';
import { writeProductAudit } from '../../domain/products/audit.js';
import { isUuid } from './_validate.js';
import { canAccessProduct } from '../../lib/access.js';

export async function deleteProduct(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  const user = c.get('user');
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(products).where(eq(products.id, id)).limit(1);
    // Multi-user: andermans product = 404 (zelfde shape als onbestaand).
    if (!existing || !canAccessProduct(user, existing)) return null;
    if (existing.status === 'archived') {
      // idempotent — al gearchiveerd
      return existing;
    }
    await tx
      .update(products)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(products.id, id));

    await writeProductAudit(tx, {
      action: 'delete',
      entityType: 'product',
      entityId: id,
      actorId: user.id,
      before: { status: existing.status },
      after: { status: 'archived' },
      ip,
    });

    return { ...existing, status: 'archived' as const };
  });

  if (!result) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ product: { id: result.id, status: 'archived' } });
}
