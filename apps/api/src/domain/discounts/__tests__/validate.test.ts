/**
 * Discount-domein E2E — tegen de ECHTE Postgres (:7432).
 *
 * Dekt `validateDiscountCode` (read-only, throwt nooit) en
 * `recordDiscountRedemption` (tx-aware, idempotent op (discountId, orderId)):
 *
 *   - percentage met cap op subtotaal
 *   - fixed met cap op subtotaal
 *   - free_shipping (freeShipping=true, discountCents=0)
 *   - venster: not_started / expired
 *   - currency_mismatch
 *   - minSubtotal niet gehaald
 *   - maxRedemptions uitgeput
 *   - maxPerCustomer (case-insensitive e-mail)
 *   - shop-specifiek wint van globaal
 *   - recordDiscountRedemption: 1e call bumpt, 2e call (zelfde order) = no-op
 *
 * Idempotent + uniek per run (eigen code-suffix + eigen test-shop) + cleanup in
 * afterAll, ook bij falen halverwege.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from '../../../lib/db.js';
import { shops } from '../../../db/schema/shops.js';
import { discounts, discountRedemptions } from '../../../db/schema/discounts.js';
import { validateDiscountCode, recordDiscountRedemption } from '../validate.js';

const RUN = Date.now().toString(36);
const SHOP_SLUG = `disc-test-${RUN}`;
const CODE = (suffix: string) => `DISC-${RUN}-${suffix}`.toUpperCase();

let shopId: string;
const discountIds: string[] = [];

/** Seed één discount-rij en onthoud het id voor cleanup. */
async function seedDiscount(
  values: Partial<typeof discounts.$inferInsert> & { code: string; type: string },
): Promise<string> {
  const [row] = await db
    .insert(discounts)
    .values({ ...values, code: values.code.toUpperCase() })
    .returning();
  discountIds.push(row!.id);
  return row!.id;
}

beforeAll(async () => {
  const [shop] = await db
    .insert(shops)
    .values({ slug: SHOP_SLUG, name: 'Discount Test Shop', status: 'active', currency: 'EUR' })
    .returning();
  shopId = shop!.id;
});

afterAll(async () => {
  try {
    if (discountIds.length) {
      // redemptions cascaden op discount-delete, maar ruim expliciet op.
      await db
        .delete(discountRedemptions)
        .where(inArray(discountRedemptions.discountId, discountIds));
      await db.delete(discounts).where(inArray(discounts.id, discountIds));
    }
    if (shopId) {
      await db.delete(shops).where(eq(shops.id, shopId));
    }
  } finally {
    await closeDb();
  }
});

describe('validateDiscountCode — korting-berekening', () => {
  it('percentage: 10% op subtotaal, gecapt op het subtotaal', async () => {
    const code = CODE('PCT');
    await seedDiscount({ code, shopId, type: 'percentage', value: '10.0000', currency: 'EUR' });

    const r = await validateDiscountCode(code, {
      shopId,
      subtotalCents: 5000, // 50.00
      currency: 'EUR',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.discountCents).toBe(500); // 10% van 5000
      expect(r.freeShipping).toBe(false);
    }
  });

  it('percentage groter dan 100% wordt gecapt op het subtotaal', async () => {
    const code = CODE('PCT200');
    await seedDiscount({ code, shopId, type: 'percentage', value: '200.0000', currency: 'EUR' });

    const r = await validateDiscountCode(code, { shopId, subtotalCents: 5000, currency: 'EUR' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.discountCents).toBe(5000); // nooit groter dan subtotaal
  });

  it('fixed: vast bedrag, gecapt op het subtotaal', async () => {
    const code = CODE('FIX');
    await seedDiscount({ code, shopId, type: 'fixed', value: '15.0000', currency: 'EUR' });

    // subtotaal > korting
    const r1 = await validateDiscountCode(code, { shopId, subtotalCents: 5000, currency: 'EUR' });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.discountCents).toBe(1500); // 15.00

    // subtotaal < korting → cap op subtotaal
    const r2 = await validateDiscountCode(code, { shopId, subtotalCents: 1000, currency: 'EUR' });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.discountCents).toBe(1000);
  });

  it('free_shipping: freeShipping=true, discountCents=0', async () => {
    const code = CODE('SHIP');
    await seedDiscount({ code, shopId, type: 'free_shipping', value: '0', currency: 'EUR' });

    const r = await validateDiscountCode(code, {
      shopId,
      subtotalCents: 5000,
      currency: 'EUR',
      shippingCents: 495,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.freeShipping).toBe(true);
      expect(r.discountCents).toBe(0);
    }
  });
});

describe('validateDiscountCode — afwijzingen (nooit een throw)', () => {
  it('niet-bestaande code → not_found', async () => {
    const r = await validateDiscountCode(CODE('NOPE'), { shopId, subtotalCents: 5000, currency: 'EUR' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });

  it('venster: not_started als startsAt in de toekomst ligt', async () => {
    const code = CODE('FUTURE');
    await seedDiscount({
      code,
      shopId,
      type: 'percentage',
      value: '10.0000',
      currency: 'EUR',
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const r = await validateDiscountCode(code, { shopId, subtotalCents: 5000, currency: 'EUR' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_started');
  });

  it('venster: expired als endsAt in het verleden ligt', async () => {
    const code = CODE('EXPIRED');
    await seedDiscount({
      code,
      shopId,
      type: 'percentage',
      value: '10.0000',
      currency: 'EUR',
      endsAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const r = await validateDiscountCode(code, { shopId, subtotalCents: 5000, currency: 'EUR' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expired');
  });

  it('currency_mismatch als de cart-valuta afwijkt van de code-valuta', async () => {
    const code = CODE('CURR');
    await seedDiscount({ code, shopId, type: 'fixed', value: '10.0000', currency: 'EUR' });
    const r = await validateDiscountCode(code, { shopId, subtotalCents: 5000, currency: 'USD' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('currency_mismatch');
  });

  it('min_subtotal als het subtotaal onder de drempel ligt', async () => {
    const code = CODE('MIN');
    await seedDiscount({
      code,
      shopId,
      type: 'fixed',
      value: '10.0000',
      currency: 'EUR',
      minSubtotal: '50.0000',
    });
    // 49.99 < 50.00 → afgewezen
    const tooLow = await validateDiscountCode(code, { shopId, subtotalCents: 4999, currency: 'EUR' });
    expect(tooLow.ok).toBe(false);
    if (!tooLow.ok) expect(tooLow.reason).toBe('min_subtotal');
    // 50.00 → ok
    const ok = await validateDiscountCode(code, { shopId, subtotalCents: 5000, currency: 'EUR' });
    expect(ok.ok).toBe(true);
  });

  it('exhausted als maxRedemptions bereikt is', async () => {
    const code = CODE('EXH');
    await seedDiscount({
      code,
      shopId,
      type: 'fixed',
      value: '10.0000',
      currency: 'EUR',
      maxRedemptions: 2,
      timesRedeemed: 2,
    });
    const r = await validateDiscountCode(code, { shopId, subtotalCents: 5000, currency: 'EUR' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('exhausted');
  });

  it('per_customer_limit (case-insensitive e-mail) na een eerdere redemption', async () => {
    const code = CODE('PERCUST');
    const id = await seedDiscount({
      code,
      shopId,
      type: 'fixed',
      value: '10.0000',
      currency: 'EUR',
      maxPerCustomer: 1,
    });
    // Eén eerdere redemption met een HOOFDLETTER-variant van de e-mail.
    await db.insert(discountRedemptions).values({
      discountId: id,
      orderId: null,
      customerEmail: 'Repeat.Buyer@Example.COM',
      amountApplied: '10.0000',
    });

    // Dezelfde klant in lowercase → limiet bereikt (case-insensitive match).
    const blocked = await validateDiscountCode(code, {
      shopId,
      subtotalCents: 5000,
      currency: 'EUR',
      customerEmail: 'repeat.buyer@example.com',
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe('per_customer_limit');

    // Een ANDERE klant mag nog wel.
    const other = await validateDiscountCode(code, {
      shopId,
      subtotalCents: 5000,
      currency: 'EUR',
      customerEmail: 'someone-else@example.com',
    });
    expect(other.ok).toBe(true);
  });
});

describe('validateDiscountCode — scope: shop-specifiek wint van globaal', () => {
  it('kiest de shop-specifieke code wanneer er ook een globale met dezelfde tekst is', async () => {
    const code = CODE('SCOPE');
    // Globaal (shopId null) = 5%, shop-specifiek = 25%.
    await seedDiscount({ code, shopId: null, type: 'percentage', value: '5.0000', currency: 'EUR' });
    await seedDiscount({ code, shopId, type: 'percentage', value: '25.0000', currency: 'EUR' });

    const r = await validateDiscountCode(code, { shopId, subtotalCents: 10000, currency: 'EUR' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 25% (shop-specifiek) i.p.v. 5% (globaal) → 2500 i.p.v. 500.
      expect(r.discountCents).toBe(2500);
      expect(r.discount.shopId).toBe(shopId);
    }
  });
});

describe('recordDiscountRedemption — idempotent op (discountId, orderId)', () => {
  it('1e call schrijft een rij + bumpt times_redeemed; 2e call (zelfde order) is een no-op', async () => {
    const code = CODE('REDEEM');
    const id = await seedDiscount({ code, shopId, type: 'fixed', value: '10.0000', currency: 'EUR' });
    // Een synthetisch order-id (geen FK-constraint op discount_redemptions.order_id).
    const orderId = '00000000-0000-4000-8000-0000000000d1';

    await recordDiscountRedemption(db, id, {
      orderId,
      customerEmail: 'redeem@example.com',
      amountAppliedCents: 1000,
    });

    let rows = await db
      .select()
      .from(discountRedemptions)
      .where(eq(discountRedemptions.discountId, id));
    expect(rows).toHaveLength(1);
    let [d1] = await db.select().from(discounts).where(eq(discounts.id, id));
    expect(d1!.timesRedeemed).toBe(1);

    // Tweede call met hetzelfde (discountId, orderId) → geen tweede rij, geen bump.
    await recordDiscountRedemption(db, id, {
      orderId,
      customerEmail: 'redeem@example.com',
      amountAppliedCents: 1000,
    });

    rows = await db
      .select()
      .from(discountRedemptions)
      .where(eq(discountRedemptions.discountId, id));
    expect(rows).toHaveLength(1);
    [d1] = await db.select().from(discounts).where(eq(discounts.id, id));
    expect(d1!.timesRedeemed).toBe(1);
  });
});
