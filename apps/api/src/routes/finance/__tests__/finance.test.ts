/**
 * Finance-module integratie-tests â€” draaien tegen de ECHTE Postgres (:7432).
 *
 * Strategie: bouw de Hono-app met de echte `financeRoutes`, mock alleen de
 * auth-middleware (geen sessie-cookie nodig). Alle DB-calls gaan naar de echte
 * DB. We seeden test-data met een unieke prefix, asserten gedrag, en ruimen
 * alles op in `afterAll`.
 *
 * Run: `pnpm -C <repo> --filter @webshop-crm/api test`
 *
 * Dekt:
 *   - seedVatRates() idempotent + BTW-lookup endpoint
 *   - ledger-aggregatie (source=orders) over een geseede order
 *   - invoice genereren uit een order
 *   - UBL 2.1-XML genereren + well-formedness valideren
 *   - OSS-CSV genereren met expliciete rows
 *   - pure VAT-math (centen, geen float-drift)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// â”€â”€ Mock auth: altijd ingelogde admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
vi.mock('../../../middleware/auth.js', () => ({
  requireAuth: async (c: any, next: any) => {
    c.set('user', { id: '00000000-0000-0000-0000-000000000001', email: 'test@example.com', role: 'admin' });
    await next();
  },
}));

import { Hono } from 'hono';
import { db, closeDb } from '../../../lib/db.js';
import {
  vatRates,
  shops,
  orders,
  orderItems,
  invoices,
} from '../../../db/schema/index.js';
import { seedVatRates } from '../../../db/seed-vat.js';
import { financeRoutes } from '../index.js';
import { splitVat, toCents, centsToMoney, marginCents, marginPct } from '../../../domain/finance/vat-math.js';
import { isWellFormedXml } from '../../../domain/finance/ubl.js';

const SHOP_SLUG = `fin-test-${Date.now()}`;
let shopId = '';
let orderId = '';
let invoiceId = '';

function buildApp() {
  const app = new Hono();
  app.route('/api/finance', financeRoutes);
  return app;
}

beforeAll(async () => {
  // 1. Seed vat_rates (idempotent).
  await seedVatRates();

  // 2. Test-shop.
  const [shop] = await db
    .insert(shops)
    .values({ slug: SHOP_SLUG, name: 'Finance Test Shop', vatConfig: { defaultCountry: 'NL' } })
    .returning();
  shopId = shop!.id;

  // 3. Test-order (betaald) + 1 item met cost_price voor marge.
  //    subtotal = netto (excl BTW), tax = BTW, grand = incl.
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      orderNumber: 'FIN-1001',
      email: 'klant@example.com',
      channel: 'web',
      status: 'paid',
      financialStatus: 'paid',
      currency: 'EUR',
      subtotal: '100.0000',
      taxTotal: '21.0000',
      shippingTotal: '0.0000',
      grandTotal: '121.0000',
      billingAddress: {
        name: 'Jan Klant',
        line1: 'Teststraat 1',
        postcode: '1011AA',
        city: 'Amsterdam',
        country: 'NL',
      },
    })
    .returning();
  orderId = order!.id;

  await db.insert(orderItems).values({
    orderId,
    sku: 'FIN-SKU-1',
    title: 'Test Koffie 1kg',
    quantity: 2,
    unitPrice: '50.0000',
    taxRate: '21',
    taxAmount: '21.0000',
    costPrice: '30.0000', // COGS = 30 Ã— 2 = 60
    lineTotal: '100.0000',
  });
});

afterAll(async () => {
  // Opruimen in FK-veilige volgorde.
  if (orderId) {
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
  }
  if (invoiceId) {
    await db.delete(invoices).where(eq(invoices.id, invoiceId));
  } else if (orderId) {
    await db.delete(invoices).where(eq(invoices.orderId, orderId));
  }
  if (orderId) {
    await db.delete(orders).where(eq(orders.id, orderId));
  }
  if (shopId) {
    await db.delete(shops).where(eq(shops.id, shopId));
  }
  await closeDb();
});

describe('pure VAT-math (centen, geen float-drift)', () => {
  it('toCents/centsToMoney round-trip', () => {
    expect(toCents('100.0000')).toBe(10000);
    expect(toCents('0.1')).toBe(10);
    expect(centsToMoney(12345)).toBe('123.4500');
    expect(centsToMoney(-50)).toBe('-0.5000');
  });

  it('splitVat inclusive 121 @21% â†’ net 100, vat 21', () => {
    const { netCents, vatCents, grossCents } = splitVat(12100, 21, true);
    expect(netCents).toBe(10000);
    expect(vatCents).toBe(2100);
    expect(grossCents).toBe(12100);
  });

  it('splitVat exclusive 100 @21% â†’ net 100, vat 21, gross 121', () => {
    const { netCents, vatCents, grossCents } = splitVat(10000, 21, false);
    expect(netCents).toBe(10000);
    expect(vatCents).toBe(2100);
    expect(grossCents).toBe(12100);
  });

  it('margin: revenue 100 cogs 60 â†’ 40 / 40%', () => {
    expect(marginCents(10000, 6000)).toBe(4000);
    expect(marginPct(10000, 6000)).toBe(40);
  });
});

describe('seed-vat + BTW-lookup', () => {
  it('seedVatRates is idempotent (2e run insert=0)', async () => {
    const second = await seedVatRates();
    expect(second.inserted).toBe(0);
    expect(second.total).toBeGreaterThanOrEqual(12);
  });

  it('vat_rates bevat NL standard 21', async () => {
    const rows = await db.select().from(vatRates).where(eq(vatRates.country, 'NL'));
    const standard = rows.find((r) => r.taxClass === 'standard');
    expect(standard).toBeTruthy();
    expect(Number(standard!.rate)).toBe(21);
  });

  it('GET /vat-rates/lookup?country=DE&tax_class=standard â†’ 19', async () => {
    const app = buildApp();
    const res = await app.request('/api/finance/vat-rates/lookup?country=DE&tax_class=standard');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Number(body.rate)).toBe(19);
    expect(body.country).toBe('DE');
  });

  it('GET /vat-rates/lookup onbekend land â†’ 404', async () => {
    const app = buildApp();
    const res = await app.request('/api/finance/vat-rates/lookup?country=ZZ&tax_class=standard');
    expect(res.status).toBe(404);
  });

  it('GET /vat-rates/lookup invalid (country len) â†’ 400', async () => {
    const app = buildApp();
    const res = await app.request('/api/finance/vat-rates/lookup?country=NLX');
    expect(res.status).toBe(400);
  });
});

describe('ledger-aggregatie (source=orders)', () => {
  it('GET /ledger/aggregate?shop_id=... rapporteert omzet/marge/BTW', async () => {
    const app = buildApp();
    const res = await app.request(
      `/api/finance/ledger/aggregate?shop_id=${shopId}&source=orders&period=month`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const row = body.items.find((r: any) => r.shopId === shopId);
    expect(row).toBeTruthy();
    // revenue (subtotal) 100, vat 21, cogs 60, margin 40
    expect(Number(row.revenue)).toBe(100);
    expect(Number(row.vat)).toBe(21);
    expect(Number(row.cogs)).toBe(60);
    expect(Number(row.margin)).toBe(40);
    expect(row.marginPct).toBe(40);
  });

  it('GET /pnl?shop_id=... rapporteert P&L-totalen', async () => {
    const app = buildApp();
    const res = await app.request(`/api/finance/pnl?shop_id=${shopId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Number(body.revenueNet)).toBe(100);
    expect(Number(body.cogs)).toBe(60);
    expect(Number(body.grossMargin)).toBe(40);
    expect(Number(body.vat)).toBe(21);
    expect(body.orderCount).toBe(1);
  });
});

describe('invoice generate + UBL export', () => {
  it('POST /invoices/generate maakt invoice uit order', async () => {
    const app = buildApp();
    const res = await app.request('/api/finance/invoices/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, type: 'sales' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.invoice).toBeTruthy();
    expect(body.invoice.shopId).toBe(shopId);
    expect(Number(body.invoice.subtotal)).toBe(100);
    expect(Number(body.invoice.vatTotal)).toBe(21);
    invoiceId = body.invoice.id;
  });

  it('POST /invoices/generate 2e keer (sales) â†’ 409 invoice_exists', async () => {
    const app = buildApp();
    const res = await app.request('/api/finance/invoices/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, type: 'sales' }),
    });
    expect(res.status).toBe(409);
  });

  it('POST /exports/ubl genereert well-formed UBL 2.1-XML', async () => {
    const app = buildApp();
    const res = await app.request('/api/finance/exports/ubl', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoice_id: invoiceId, persist: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<Invoice');
    expect(xml).toContain('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
    expect(xml).toContain('<cbc:ID>');
    expect(xml).toContain('<cac:TaxTotal>');
    expect(xml).toContain('<cac:InvoiceLine>');
    // well-formed volgens onze balanstest
    expect(isWellFormedXml(xml)).toBe(true);

    // persist: ubl_xml staat nu in de DB
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    expect(inv!.ublXml).toBeTruthy();
  });

  it('GET /invoices/:id levert detail incl ublXml', async () => {
    const app = buildApp();
    const res = await app.request(`/api/finance/invoices/${invoiceId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.invoice.id).toBe(invoiceId);
    expect(typeof body.invoice.ublXml).toBe('string');
  });
});

describe('OSS-CSV export', () => {
  it('POST /exports/oss met expliciete rows â†’ CSV met header + regels', async () => {
    const app = buildApp();
    const res = await app.request('/api/finance/exports/oss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        period: '2026-Q1',
        rows: [
          { country: 'DE', vatRate: 19, taxableBase: '500.00', vatAmount: '95.00' },
          { country: 'FR', vatRate: 20, taxableBase: '250.00', vatAmount: '50.00' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('period,country_of_consumption,vat_rate,taxable_base,vat_amount,currency');
    expect(lines.length).toBe(3); // header + 2 rows
    expect(lines[1]).toContain('DE');
    expect(lines[1]).toContain('19.00');
  });

  it('POST /exports/oss invalid period â†’ 400', async () => {
    const app = buildApp();
    const res = await app.request('/api/finance/exports/oss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ period: 'not-a-quarter' }),
    });
    expect(res.status).toBe(400);
  });
});
