/**
 * BTW/ledger-reconciliatie E2E — tegen de ECHTE Postgres (:7432).
 *
 * Regressie voor de net/btw-split-fix: een storefront-checkout van een BRUTO
 * geprijsd product moet leiden tot:
 *   - order.subtotal == NETTO (excl. btw)
 *   - order.taxTotal == de ingesloten btw
 *   - net + btw == bruto (geen afrond-lek)
 *   - ALLE ledger_entries van de order zijn gebalanceerd (sum debit == sum credit)
 *     met de revenue-regel == netto en de vat_payable-regel == btw.
 *
 * Geen PSP geconfigureerd op de shop → mock-paid pad → ledger wordt direct
 * geboekt in de checkout-transactie.
 *
 * Gebaseerd op storefront.test.ts (unieke shop-slug per run + cleanup in afterAll).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from '../../../lib/db.js';
import {
  shops,
  shopProducts,
  products,
  variants,
  inventoryItems,
  inventoryLevels,
  locations,
  carts,
  customers,
  orders,
  ledgerEntries,
} from '../../../db/schema/index.js';
import { storefrontRoutes } from '../index.js';
import { toCents } from '../../../domain/finance/vat-math.js';

const RUN = Date.now().toString(36);
const SHOP_SLUG = `vat-test-${RUN}`;
const PRODUCT_SLUG = `vat-prod-${RUN}`;
const TEST_EMAIL = `vat-buyer-${RUN}@example.com`;

// Bruto stuksprijs (incl. 21% btw). 100.00 incl → net 82.64, btw 17.36.
const GROSS_UNIT = '100.0000';
const QTY = 2;
// Verwacht (in centen), berekend zoals splitVat(inclusive) het doet:
//   net = round(gross * 100 / 121); vat = gross - net  — per regel (qty meegerekend).
const grossLineCents = toCents(GROSS_UNIT) * QTY; // 20000
const expectedNetCents = Math.round((grossLineCents * 100) / 121); // 16529
const expectedVatCents = grossLineCents - expectedNetCents; // 3471

let shopId: string;
let productId: string;
let variantId: string;
let locationId: string;
let itemId: string;
let orderId: string;

function app() {
  const a = new Hono();
  a.route('/api/storefront/v1', storefrontRoutes);
  return a;
}

function req(a: ReturnType<typeof app>, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('X-Shop-Slug', SHOP_SLUG);
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return a.request(`/api/storefront/v1${path}`, { ...init, headers });
}

beforeAll(async () => {
  const [loc] = await db
    .insert(locations)
    .values({ code: `VAT-LOC-${RUN}`, name: 'VAT Test Warehouse', type: 'warehouse' })
    .returning();
  locationId = loc!.id;

  const [shop] = await db
    .insert(shops)
    .values({ slug: SHOP_SLUG, name: 'VAT Test Shop', status: 'active', currency: 'EUR' })
    .returning();
  shopId = shop!.id;

  const [prod] = await db
    .insert(products)
    .values({ slug: PRODUCT_SLUG, title: 'VAT Demo', status: 'active' })
    .returning();
  productId = prod!.id;

  const [variant] = await db
    .insert(variants)
    .values({
      productId,
      sku: `VAT-SKU-${RUN}`,
      price: GROSS_UNIT, // bruto, standard tax class → 21%
      costPrice: '40.0000',
      taxClass: 'standard',
      active: true,
    })
    .returning();
  variantId = variant!.id;

  const [item] = await db
    .insert(inventoryItems)
    .values({ variantId, sku: `VAT-SKU-${RUN}`, tracked: true })
    .returning();
  itemId = item!.id;
  await db.insert(inventoryLevels).values({
    itemId,
    locationId,
    onHand: 10,
    available: 10,
    committed: 0,
  });

  await db.insert(shopProducts).values({
    shopId,
    productId,
    published: true,
    position: 0,
    publishedAt: new Date(),
  });
});

afterAll(async () => {
  try {
    if (orderId) {
      await db.delete(ledgerEntries).where(eq(ledgerEntries.orderId, orderId));
    }
    if (shopId) {
      const shopOrders = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.shopId, shopId));
      if (shopOrders.length > 0) {
        await db.delete(orders).where(inArray(orders.id, shopOrders.map((o) => o.id)));
      }
      await db.delete(carts).where(eq(carts.shopId, shopId));
      await db.delete(customers).where(eq(customers.shopId, shopId));
      await db.delete(shopProducts).where(eq(shopProducts.shopId, shopId));
    }
    if (itemId) {
      await db.delete(inventoryLevels).where(eq(inventoryLevels.itemId, itemId));
      await db.delete(inventoryItems).where(eq(inventoryItems.id, itemId));
    }
    if (productId) await db.delete(products).where(eq(products.id, productId));
    if (shopId) await db.delete(shops).where(eq(shops.id, shopId));
    if (locationId) await db.delete(locations).where(eq(locations.id, locationId));
  } finally {
    await closeDb();
  }
});

describe('bruto-checkout → netto subtotaal + btw + gebalanceerde ledger', () => {
  it('order.subtotal is NETTO, taxTotal is de btw, en net+btw == bruto', async () => {
    const a = app();

    const createRes = await req(a, '/cart', { method: 'POST' });
    expect(createRes.status).toBe(201);
    const token = ((await createRes.json()) as any).cart.token as string;

    const addRes = await req(a, `/cart/${token}/items`, {
      method: 'POST',
      body: JSON.stringify({ variantId, quantity: QTY }),
    });
    expect(addRes.status).toBe(201);

    const checkoutRes = await req(a, `/cart/${token}/checkout`, {
      method: 'POST',
      body: JSON.stringify({
        email: TEST_EMAIL,
        firstName: 'Vat',
        lastName: 'Tester',
        shippingAddress: {
          line1: 'Teststraat 1',
          postcode: '1234 AB',
          city: 'Amsterdam',
          country: 'NL',
        },
        shippingTotal: '0',
      }),
    });
    expect(checkoutRes.status).toBe(201);
    const body = (await checkoutRes.json()) as any;
    orderId = body.order.id;

    // subtotal == netto, taxTotal == btw.
    expect(toCents(body.order.subtotal)).toBe(expectedNetCents);
    expect(toCents(body.order.taxTotal)).toBe(expectedVatCents);
    // net + btw == bruto (geen afrond-lek) en == grandTotal (geen verzending/korting).
    expect(expectedNetCents + expectedVatCents).toBe(grossLineCents);
    expect(toCents(body.order.grandTotal)).toBe(grossLineCents);
    // Mock-paid pad: order direct betaald.
    expect(body.order.financialStatus).toBe('paid');
  });

  it('alle ledger_entries van de order zijn gebalanceerd; revenue==netto, vat_payable==btw', async () => {
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.orderId, orderId));
    expect(entries.length).toBeGreaterThan(0);

    // sum(debit) == sum(credit) in centen.
    let debit = 0;
    let credit = 0;
    for (const e of entries) {
      debit += toCents(e.debit);
      credit += toCents(e.credit);
    }
    expect(debit).toBe(credit);

    // revenue (credit) == netto, vat_payable (credit) == btw.
    const revenue = entries.find((e) => e.account === 'revenue');
    const vat = entries.find((e) => e.account === 'vat_payable');
    expect(revenue).toBeTruthy();
    expect(vat).toBeTruthy();
    expect(toCents(revenue!.credit)).toBe(expectedNetCents);
    expect(toCents(vat!.credit)).toBe(expectedVatCents);

    // De vorderingen-regel (trade_debtors, debit) == bruto.
    const tradeDebtors = entries.find((e) => e.account === 'trade_debtors');
    expect(tradeDebtors).toBeTruthy();
    expect(toCents(tradeDebtors!.debit)).toBe(grossLineCents);
  });
});
