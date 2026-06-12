/**
 * Multi-user toegangslaag.
 *
 * Model:
 *  - `users.role = 'admin'`  → operator: ziet en mag ALLES (geconsolideerd).
 *  - `users.role = 'user'`   → tenant: ziet alleen shops waar die member van is
 *                              (shop_members) en alleen eigen producten
 *                              (products.owner_user_id).
 *  - `users.role = 'disabled'` → login werkt, maar requireAuth-consumers
 *                              behandelen dit als geen toegang (bestaand gedrag).
 *
 * Route-code gebruikt deze helpers; de regels staan op 1 plek zodat ze
 * consistent en testbaar zijn.
 */
import { eq, and } from 'drizzle-orm';
import { db } from './db.js';
import { shopMembers } from '../db/schema/shop-members.js';
import type { AuthUser } from './auth.js';

export function isAdmin(user: Pick<AuthUser, 'role'>): boolean {
  return user.role === 'admin';
}

/** Shop-ids waar deze user member van is (alleen relevant voor role 'user'). */
export async function getMemberShopIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ shopId: shopMembers.shopId })
    .from(shopMembers)
    .where(eq(shopMembers.userId, userId));
  return rows.map((r) => r.shopId);
}

/**
 * Toegankelijke shop-ids voor list-queries.
 * `null` = onbeperkt (admin); anders een (mogelijk lege) lijst shop-ids.
 */
export async function accessibleShopIds(user: AuthUser): Promise<string[] | null> {
  if (isAdmin(user)) return null;
  return getMemberShopIds(user.id);
}

/** Mag deze user bij deze specifieke shop? */
export async function canAccessShop(user: AuthUser, shopId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const [row] = await db
    .select({ id: shopMembers.id })
    .from(shopMembers)
    .where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.userId, user.id)))
    .limit(1);
  return Boolean(row);
}

/** Voeg een member toe (idempotent: negeert bestaand lidmaatschap). */
export async function addShopMember(
  shopId: string,
  userId: string,
  role: 'owner' | 'staff' = 'owner',
): Promise<void> {
  await db
    .insert(shopMembers)
    .values({ shopId, userId, role })
    .onConflictDoNothing({ target: [shopMembers.shopId, shopMembers.userId] });
}

/**
 * Mag deze user dit product zien/beheren?
 * Admin: alles. User: alleen `ownerUserId === user.id`.
 * Producten met `ownerUserId = null` zijn platform-catalogus (alleen admin).
 */
export function canAccessProduct(
  user: AuthUser,
  product: { ownerUserId: string | null },
): boolean {
  if (isAdmin(user)) return true;
  return product.ownerUserId === user.id;
}
