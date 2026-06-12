/**
 * Discounts-router — `/api/discounts/*`.
 *
 * Beheer van kortings-/vouchercodes (percentage / vast bedrag / gratis
 * verzending) met voorwaarden (min. subtotaal, geldigheidsvenster, gebruiks-
 * limieten, per-shop of globaal). De route-laag doet CRUD + een admin-preview
 * van de validatie; de échte validatie/inwisseling zit in
 * `domain/discounts/validate.ts` zodat de storefront-checkout die direct kan
 * aanroepen (wordt later door de orchestrator gewired).
 *
 * Endpoints (alle achter `requireAuth`):
 *   GET    /api/discounts                  — list (filters: shop_id, active, q, paginate)
 *   POST   /api/discounts                  — create (code → UPPERCASE; 409 duplicate_code)
 *   GET    /api/discounts/:id              — detail
 *   PATCH  /api/discounts/:id              — partial update (+ active)
 *   DELETE /api/discounts/:id              — delete (cascade redemptions)
 *   GET    /api/discounts/:id/redemptions  — append-only redemption-log (paginate)
 *   POST   /api/discounts/validate         — admin-preview: valideer een code tegen een subtotaal
 *
 * Geld = numeric(12,4)-string (Money) in & uit; intern centen via vat-math.
 * Alle mutaties via `runInTransactionWithAudit` (entityType 'discount').
 *
 * Wired in routes/index.ts door de orchestrator — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { and, desc, eq, ilike, inArray, isNull } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { accessibleShopIds, canAccessShop, isAdmin } from '../../lib/access.js';
import type { AuthUser } from '../../lib/auth.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { toCents, centsToMoney } from '../../domain/finance/vat-math.js';
import { validateDiscountCode } from '../../domain/discounts/validate.js';
import {
  discounts,
  discountRedemptions,
  type Discount,
} from '../../db/schema/discounts.js';
import {
  DiscountCreateSchema,
  DiscountPatchSchema,
  ListQuerySchema,
  PaginationQuerySchema,
  ValidateSchema,
} from './_schemas.js';
import { toDiscountDto, toRedemptionDto } from './_serialize.js';

export const discountRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles — admin-module.
discountRoutes.use('*', requireAuth);

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

/** Snapshot voor audit before/after (compact, geen ruis). */
function snapshot(d: Discount) {
  return {
    id: d.id,
    code: d.code,
    shopId: d.shopId,
    type: d.type,
    value: d.value,
    active: d.active,
    timesRedeemed: d.timesRedeemed,
  };
}

/**
 * Multi-user: mag deze user deze discount zien/beheren?
 * Admin: alles. User: alleen discounts van member-shops; GLOBALE discounts
 * (shopId NULL) zijn admin-only en blijven voor tenants onzichtbaar (404).
 */
async function canSeeDiscount(
  user: AuthUser,
  d: { shopId: string | null },
): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (!d.shopId) return false;
  return canAccessShop(user, d.shopId);
}

/**
 * Zoek een bestaande code binnen dezelfde scope (shop OF globaal). Postgres telt
 * NULL-shopId als distinct in de UNIQUE-index, dus voor globale codes checken we
 * hier expliciet zodat ook die uniek blijven (vriendelijke 409 i.p.v. dubbele
 * globale code).
 */
async function findCodeClash(
  code: string,
  shopId: string | null,
  excludeId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: discounts.id })
    .from(discounts)
    .where(
      and(
        eq(discounts.code, code),
        shopId ? eq(discounts.shopId, shopId) : isNull(discounts.shopId),
      ),
    );
  return rows.some((r) => r.id !== excludeId);
}

// ─── GET /api/discounts — list ───────────────────────────────

discountRoutes.get('/', async (c) => {
  const parsed = ListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { shop_id, active, q, limit, offset } = parsed.data;

  // Multi-user: non-admin ziet alleen member-shops; globale discounts
  // (shopId NULL) vallen daar nooit onder (inArray matcht geen NULL).
  const memberShopIds = await accessibleShopIds(c.get('user'));

  const conditions = [];
  if (shop_id) {
    if (memberShopIds && !memberShopIds.includes(shop_id)) {
      return c.json({ error: 'not_found' }, 404);
    }
    conditions.push(eq(discounts.shopId, shop_id));
  } else if (memberShopIds) {
    // Lege lijst → inArray rendert `false` → lege resultaten.
    conditions.push(inArray(discounts.shopId, memberShopIds));
  }
  if (active !== undefined) conditions.push(eq(discounts.active, active));
  if (q) conditions.push(ilike(discounts.code, `%${q.toUpperCase()}%`));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(discounts)
    .orderBy(desc(discounts.createdAt))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: discounts.id }).from(discounts).where(whereExpr)
    : db.select({ id: discounts.id }).from(discounts));

  return c.json({
    items: rows.map(toDiscountDto),
    total: allIds.length,
    limit,
    offset,
  });
});

// ─── POST /api/discounts — create ────────────────────────────

discountRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = DiscountCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const code = input.code.toUpperCase();
  const shopId = input.shopId ?? null;

  // Multi-user: tenants mogen GEEN globale discounts aanmaken (shopId
  // verplicht) en alleen op een toegankelijke shop (404 = geen leak).
  if (!isAdmin(user)) {
    if (!shopId) {
      return c.json(
        { error: 'invalid_request', message: 'shopId is required' },
        400,
      );
    }
    if (!(await canAccessShop(user, shopId))) {
      return c.json({ error: 'not_found' }, 404);
    }
  }

  // Duplicate-check (per shop OF globaal). 409 i.p.v. raw DB-constraint-error.
  if (await findCodeClash(code, shopId)) {
    return c.json({ error: 'duplicate_code' }, 409);
  }

  const discount = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .insert(discounts)
      .values({
        code,
        shopId,
        type: input.type,
        // free_shipping negeert value; default '0'.
        value: input.type === 'free_shipping' ? '0' : input.value ?? '0',
        ...(input.currency ? { currency: input.currency } : {}),
        minSubtotal: input.minSubtotal ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        maxRedemptions: input.maxRedemptions ?? null,
        maxPerCustomer: input.maxPerCustomer ?? null,
        ...(input.active !== undefined ? { active: input.active } : {}),
        description: input.description ?? null,
      })
      .returning();
    if (!row) throw new Error('discount insert returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'discount',
      entityId: row.id,
      before: null,
      after: snapshot(row),
      ip: ip(c),
    });
    return row;
  });

  logger.info({ discountId: discount.id, code, actor: user.id }, 'discount created');
  return c.json({ discount: toDiscountDto(discount) }, 201);
});

// ─── POST /api/discounts/validate — admin-preview ────────────
//
// Definieer VÓÓR /:id zodat 'validate' niet als :id wordt opgevangen.

discountRoutes.post('/validate', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ValidateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  // Multi-user: tenants previewen alleen binnen een eigen (member-)shop.
  // Zonder of met een niet-toegankelijke shop_id → 404 (geen code-probing).
  const user = c.get('user');
  if (!isAdmin(user)) {
    if (!input.shop_id || !(await canAccessShop(user, input.shop_id))) {
      return c.json({ error: 'not_found' }, 404);
    }
  }

  const result = await validateDiscountCode(input.code, {
    shopId: input.shop_id ?? null,
    subtotalCents: toCents(input.subtotal),
    currency: input.currency ?? 'EUR',
    customerEmail: input.customer_email ?? null,
    shippingCents: input.shipping ? toCents(input.shipping) : 0,
  });

  if (!result.ok) {
    return c.json({ valid: false, reason: result.reason, message: result.message });
  }

  return c.json({
    valid: true,
    discountId: result.discount.id,
    code: result.discount.code,
    type: result.discount.type,
    discountCents: result.discountCents,
    discount: centsToMoney(result.discountCents),
    freeShipping: result.freeShipping,
    currency: result.discount.currency,
  });
});

// ─── GET /api/discounts/:id — detail ─────────────────────────

discountRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [discount] = await db.select().from(discounts).where(eq(discounts.id, id)).limit(1);
  if (!discount) return c.json({ error: 'not_found' }, 404);
  // Multi-user: niet zichtbaar (andere shop of globaal) → zelfde 404.
  if (!(await canSeeDiscount(c.get('user'), discount))) {
    return c.json({ error: 'not_found' }, 404);
  }

  return c.json({ discount: toDiscountDto(discount) });
});

// ─── PATCH /api/discounts/:id — update ───────────────────────

discountRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = DiscountPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;

  const [existing] = await db.select().from(discounts).where(eq(discounts.id, id)).limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);
  // Multi-user: niet zichtbaar (andere shop of globaal) → zelfde 404. Tenants
  // mogen een discount ook niet globaal maken of naar een vreemde shop verhuizen.
  if (!(await canSeeDiscount(user, existing))) {
    return c.json({ error: 'not_found' }, 404);
  }
  if (!isAdmin(user) && patch.shopId !== undefined) {
    if (patch.shopId === null) {
      return c.json(
        { error: 'invalid_request', message: 'shopId is required' },
        400,
      );
    }
    if (!(await canAccessShop(user, patch.shopId))) {
      return c.json({ error: 'not_found' }, 404);
    }
  }

  // Bepaal nieuwe code/shop voor duplicate-check (alleen als één van beide wisselt).
  const nextCode = patch.code !== undefined ? patch.code.toUpperCase() : existing.code;
  const nextShopId = patch.shopId !== undefined ? patch.shopId : existing.shopId;
  if (
    (patch.code !== undefined && nextCode !== existing.code) ||
    (patch.shopId !== undefined && nextShopId !== existing.shopId)
  ) {
    if (await findCodeClash(nextCode, nextShopId, id)) {
      return c.json({ error: 'duplicate_code' }, 409);
    }
  }

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.code !== undefined) setValues.code = nextCode;
  if (patch.type !== undefined) setValues.type = patch.type;
  if (patch.value !== undefined) setValues.value = patch.value;
  if (patch.shopId !== undefined) setValues.shopId = patch.shopId;
  if (patch.currency !== undefined) setValues.currency = patch.currency;
  if (patch.minSubtotal !== undefined) setValues.minSubtotal = patch.minSubtotal;
  if (patch.startsAt !== undefined) setValues.startsAt = patch.startsAt;
  if (patch.endsAt !== undefined) setValues.endsAt = patch.endsAt;
  if (patch.maxRedemptions !== undefined) setValues.maxRedemptions = patch.maxRedemptions;
  if (patch.maxPerCustomer !== undefined) setValues.maxPerCustomer = patch.maxPerCustomer;
  if (patch.active !== undefined) setValues.active = patch.active;
  if (patch.description !== undefined) setValues.description = patch.description;

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(discounts)
      .set(setValues)
      .where(eq(discounts.id, id))
      .returning();
    if (!row) throw new Error('discount update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'discount',
      entityId: row.id,
      before: snapshot(existing),
      after: snapshot(row),
      ip: ip(c),
    });
    return row;
  });

  logger.info({ discountId: id, actor: user.id }, 'discount updated');
  return c.json({ discount: toDiscountDto(updated) });
});

// ─── DELETE /api/discounts/:id ───────────────────────────────

discountRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [existing] = await db.select().from(discounts).where(eq(discounts.id, id)).limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);
  // Multi-user: niet zichtbaar (andere shop of globaal) → zelfde 404.
  if (!(await canSeeDiscount(user, existing))) {
    return c.json({ error: 'not_found' }, 404);
  }

  await runInTransactionWithAudit(async (tx, audit) => {
    // discount_redemptions cascaden via FK onDelete:'cascade'.
    await tx.delete(discounts).where(eq(discounts.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'discount',
      entityId: id,
      before: snapshot(existing),
      after: null,
      ip: ip(c),
    });
  });

  logger.info({ discountId: id, actor: user.id }, 'discount deleted');
  return c.json({ ok: true, id });
});

// ─── GET /api/discounts/:id/redemptions ──────────────────────

discountRoutes.get('/:id/redemptions', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const parsed = PaginationQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { limit, offset } = parsed.data;

  const [discount] = await db
    .select({ id: discounts.id, shopId: discounts.shopId })
    .from(discounts)
    .where(eq(discounts.id, id))
    .limit(1);
  if (!discount) return c.json({ error: 'not_found' }, 404);
  // Multi-user: niet zichtbaar (andere shop of globaal) → zelfde 404.
  if (!(await canSeeDiscount(c.get('user'), discount))) {
    return c.json({ error: 'not_found' }, 404);
  }

  const rows = await db
    .select()
    .from(discountRedemptions)
    .where(eq(discountRedemptions.discountId, id))
    .orderBy(desc(discountRedemptions.createdAt))
    .limit(limit)
    .offset(offset);

  const allIds = await db
    .select({ id: discountRedemptions.id })
    .from(discountRedemptions)
    .where(eq(discountRedemptions.discountId, id));

  return c.json({
    discountId: id,
    items: rows.map(toRedemptionDto),
    total: allIds.length,
    limit,
    offset,
  });
});
