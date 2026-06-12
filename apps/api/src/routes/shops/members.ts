/**
 * Shop-members — multi-user lidmaatschapsbeheer per shop.
 *
 * Routes (geregistreerd op de bestaande `shopsRoutes`, dus achter `requireAuth`
 * en zonder extra mount in routes/index.ts):
 *   GET    /api/shops/:id/members            → ledenlijst (join op users voor email)
 *   POST   /api/shops/:id/members            → member toevoegen op e-mail
 *                                              body { email, role: 'owner'|'staff' (default 'staff') }
 *   DELETE /api/shops/:id/members/:memberId  → member verwijderen
 *
 * Toegangsregels:
 *   - GET:    admin of member van de shop. Non-member → 404 (geen existence-leak).
 *   - POST:   admin of member met role 'owner'. Staff-member → 403 `owner_only`.
 *   - DELETE: idem POST. De LAATSTE owner kan niet verwijderd worden
 *             (409 `last_owner`) — anders raakt de shop verweesd.
 *
 * POST is idempotent: bestaat het lidmaatschap al, dan 200 met de bestaande rij
 * (role blijft ongewijzigd); nieuw lidmaatschap → 201. Onbekende e-mail →
 * 404 `user_not_found`.
 *
 * Writes lopen via `runInTransactionWithAudit` (entityType `shop_member`).
 */
import type { Hono } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import type { AuthVariables } from '../../middleware/auth.js';
import { shops } from '../../db/schema/shops.js';
import { users } from '../../db/schema/users.js';
import { shopMembers, type ShopMember } from '../../db/schema/shop-members.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { canAccessShop, isAdmin } from '../../lib/access.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import type { AuthUser } from '../../lib/auth.js';

const MemberAddSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  role: z.enum(['owner', 'staff']).default('staff'),
});

function toMemberDto(row: ShopMember & { email: string }) {
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Rol van deze user binnen de shop, of null als geen member. */
async function getMemberRole(shopId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: shopMembers.role })
    .from(shopMembers)
    .where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

/** Bestaat de shop? (admin heeft geen membership, dus expliciete check nodig.) */
async function shopExists(shopId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  return Boolean(row);
}

/**
 * Toegangscheck voor de members-writes: admin of owner-member.
 * Returnt null bij toegang, anders de juiste error-Response-payload.
 */
async function requireOwnerOrAdmin(
  user: AuthUser,
  shopId: string,
): Promise<{ status: 403 | 404; body: Record<string, string> } | null> {
  if (isAdmin(user)) return null;
  const role = await getMemberRole(shopId, user.id);
  if (role === null) return { status: 404, body: { error: 'not_found' } };
  if (role !== 'owner') return { status: 403, body: { error: 'forbidden', detail: 'owner_only' } };
  return null;
}

/**
 * Registreer de members-routes op de bestaande shops-router (zelfde patroon
 * als storefront-token.ts) — geen extra wiring in routes/index.ts nodig.
 */
export function registerMemberRoutes(router: Hono<{ Variables: AuthVariables }>): void {
  // ─── GET /api/shops/:id/members — ledenlijst ───────────────────
  router.get('/:id/members', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) {
      return c.json({ error: 'invalid_id' }, 400);
    }
    const user = c.get('user');
    // Multi-user: non-member krijgt 404 (geen existence-leak).
    if (!(await canAccessShop(user, id))) {
      return c.json({ error: 'not_found' }, 404);
    }
    if (!(await shopExists(id))) {
      return c.json({ error: 'not_found' }, 404);
    }

    const rows = await db
      .select({
        id: shopMembers.id,
        shopId: shopMembers.shopId,
        userId: shopMembers.userId,
        email: users.email,
        role: shopMembers.role,
        createdAt: shopMembers.createdAt,
      })
      .from(shopMembers)
      .innerJoin(users, eq(users.id, shopMembers.userId))
      .where(eq(shopMembers.shopId, id))
      .orderBy(asc(shopMembers.createdAt));

    return c.json({ shopId: id, items: rows.map(toMemberDto), total: rows.length });
  });

  // ─── POST /api/shops/:id/members — member toevoegen op e-mail ──
  router.post('/:id/members', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) {
      return c.json({ error: 'invalid_id' }, 400);
    }
    const user = c.get('user');
    const denied = await requireOwnerOrAdmin(user, id);
    if (denied) return c.json(denied.body, denied.status);
    if (!(await shopExists(id))) {
      return c.json({ error: 'not_found' }, 404);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = MemberAddSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
    }
    const { email, role } = parsed.data;
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

    // Zoek de user op e-mail (case-insensitive).
    const [target] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(sql`lower(${users.email})`, email))
      .limit(1);
    if (!target) {
      return c.json({ error: 'user_not_found' }, 404);
    }

    // Idempotent: bestaat het lidmaatschap al, geef de bestaande rij terug.
    const [existing] = await db
      .select()
      .from(shopMembers)
      .where(and(eq(shopMembers.shopId, id), eq(shopMembers.userId, target.id)))
      .limit(1);
    if (existing) {
      return c.json({ member: toMemberDto({ ...existing, email: target.email }) }, 200);
    }

    const member = await runInTransactionWithAudit(async (tx, audit) => {
      const [row] = await tx
        .insert(shopMembers)
        .values({ shopId: id, userId: target.id, role })
        .onConflictDoNothing({ target: [shopMembers.shopId, shopMembers.userId] })
        .returning();
      // Race met parallelle insert → conflict, lees de bestaande rij.
      if (!row) {
        const [raced] = await tx
          .select()
          .from(shopMembers)
          .where(and(eq(shopMembers.shopId, id), eq(shopMembers.userId, target.id)))
          .limit(1);
        if (!raced) throw new Error('shop_member insert returned no row');
        return { row: raced, created: false };
      }
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'create',
        entityType: 'shop_member',
        entityId: row.id,
        before: null,
        after: { shopId: id, userId: target.id, role: row.role },
        ip,
      });
      return { row, created: true };
    });

    logger.info(
      { shopId: id, memberUserId: target.id, role: member.row.role, actor: user.id },
      'shop member added',
    );
    return c.json(
      { member: toMemberDto({ ...member.row, email: target.email }) },
      member.created ? 201 : 200,
    );
  });

  // ─── DELETE /api/shops/:id/members/:memberId — verwijderen ─────
  router.delete('/:id/members/:memberId', async (c) => {
    const id = c.req.param('id');
    const memberId = c.req.param('memberId');
    if (!isUuid(id) || !isUuid(memberId)) {
      return c.json({ error: 'invalid_id' }, 400);
    }
    const user = c.get('user');
    const denied = await requireOwnerOrAdmin(user, id);
    if (denied) return c.json(denied.body, denied.status);

    const [member] = await db
      .select()
      .from(shopMembers)
      .where(and(eq(shopMembers.id, memberId), eq(shopMembers.shopId, id)))
      .limit(1);
    if (!member) {
      return c.json({ error: 'not_found' }, 404);
    }

    // Last-owner-guard: de laatste owner mag er niet af (verweesde shop).
    if (member.role === 'owner') {
      const owners = await db
        .select({ id: shopMembers.id })
        .from(shopMembers)
        .where(and(eq(shopMembers.shopId, id), eq(shopMembers.role, 'owner')));
      if (owners.length <= 1) {
        return c.json({ error: 'last_owner' }, 409);
      }
    }

    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;
    await runInTransactionWithAudit(async (tx, audit) => {
      await tx.delete(shopMembers).where(eq(shopMembers.id, memberId));
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'delete',
        entityType: 'shop_member',
        entityId: memberId,
        before: { shopId: member.shopId, userId: member.userId, role: member.role },
        after: null,
        ip,
      });
    });

    logger.info(
      { shopId: id, memberId, memberUserId: member.userId, actor: user.id },
      'shop member removed',
    );
    return c.json({ ok: true, id: memberId });
  });
}
