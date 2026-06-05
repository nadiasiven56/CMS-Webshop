/**
 * Finance-router — `/api/finance/*`.  Achter `requireAuth`.
 *
 * Endpoints (zie REGISTER.md voor de volledige lijst):
 *   GET  /api/finance/vat-rates                 — alle BTW-tarieven
 *   GET  /api/finance/vat-rates/lookup          — (country, tax_class) → rate
 *   GET  /api/finance/ledger                    — ledger_entries paginated + filter
 *   GET  /api/finance/ledger/aggregate          — omzet/marge/BTW per shop+kanaal+periode
 *   GET  /api/finance/pnl                        — P&L (omzet/COGS/marge/BTW) per shop+periode
 *   GET  /api/finance/invoices                   — invoices list
 *   GET  /api/finance/invoices/:id               — invoice detail (incl ubl_xml)
 *   POST /api/finance/invoices/generate          — invoice genereren uit een order
 *   POST /api/finance/exports/ubl                — UBL 2.1-XML uit een invoice
 *   POST /api/finance/exports/oss                — OSS-CSV per land+tarief over een periode
 *
 * Geld blijft string (Money). Aggregaties rekenen in hele centen
 * (`domain/finance/vat-math.ts`) → geen float-drift. Arrays in WHERE via
 * `inArray` (NOOIT `= ANY(...)`).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, desc, eq, gte, lte, inArray, count, sql, type AnyColumn } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import {
  vatRates,
  ledgerEntries,
  invoices,
  orders,
  orderItems,
  shops,
} from '../../db/schema/index.js';
import {
  toVatRateDto,
  toLedgerEntryDto,
  toInvoiceDto,
} from './_serialize.js';
import {
  toCents,
  centsToMoney,
  splitVat,
  marginCents,
  marginPct,
} from '../../domain/finance/vat-math.js';
import {
  generateUblInvoice,
  isWellFormedXml,
  type UblInvoiceInput,
  type UblLine,
} from '../../domain/finance/ubl.js';
import { generateOssCsv, type OssRow } from '../../domain/finance/oss-csv.js';

export const financeRoutes = new Hono<{ Variables: AuthVariables }>();

financeRoutes.use('*', requireAuth);

// ─── helpers ─────────────────────────────────────────────────
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string | undefined | null): v is string {
  return typeof v === 'string' && UUID_REGEX.test(v);
}

/** Postgres date_trunc-bucket → 'YYYY-MM-DD' label per granulariteit. */
const PeriodSchema = z.enum(['day', 'week', 'month']);
type Period = z.infer<typeof PeriodSchema>;

/**
 * Bouw een date_trunc-bucket-expressie. `period` wordt als RAW literal
 * geïnjecteerd (NIET als bound parameter) — anders triggert Postgres 42803
 * ("must appear in GROUP BY") omdat een geparametriseerde expressie in de
 * SELECT-list niet gelijk wordt geacht aan dezelfde in GROUP BY. `period` is
 * een gevalideerde enum, dus injectie is veilig.
 */
function dateBucket(column: AnyColumn, period: Period) {
  return sql<string>`to_char(date_trunc('${sql.raw(period)}', ${column}::timestamp), 'YYYY-MM-DD')`;
}

/** Centen-string ('2dec') uit numeric-string of null. */
function money2(value: string | number | null | undefined): string {
  // 2-decimalen weergave voor UBL/CSV (centen exact, geen tonende vierde dec.)
  const c = toCents(value);
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════════════
// 1. BTW-tarieven
// ════════════════════════════════════════════════════════════════

const vatListQuerySchema = z.object({
  country: z.string().trim().length(2).optional(),
  tax_class: z.enum(['standard', 'reduced', 'zero']).optional(),
});

financeRoutes.get('/vat-rates', async (c) => {
  const parsed = vatListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { country, tax_class } = parsed.data;
  const conds = [];
  if (country) conds.push(eq(vatRates.country, country.toUpperCase()));
  if (tax_class) conds.push(eq(vatRates.taxClass, tax_class));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select()
    .from(vatRates)
    .where(where)
    .orderBy(asc(vatRates.country), asc(vatRates.taxClass), desc(vatRates.validFrom));
  return c.json({ items: rows.map(toVatRateDto), total: rows.length });
});

const vatLookupSchema = z.object({
  country: z.string().trim().length(2),
  tax_class: z.enum(['standard', 'reduced', 'zero']).default('standard'),
});

/** GET /api/finance/vat-rates/lookup?country=NL&tax_class=standard → rate. */
financeRoutes.get('/vat-rates/lookup', async (c) => {
  const parsed = vatLookupSchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const country = parsed.data.country.toUpperCase();
  const taxClass = parsed.data.tax_class;

  // Meest recente geldige rate (valid_from <= today), hoogste valid_from eerst.
  const [row] = await db
    .select()
    .from(vatRates)
    .where(
      and(
        eq(vatRates.country, country),
        eq(vatRates.taxClass, taxClass),
        lte(vatRates.validFrom, sql`CURRENT_DATE`),
      ),
    )
    .orderBy(desc(vatRates.validFrom))
    .limit(1);

  if (!row) {
    return c.json({ error: 'rate_not_found', country, taxClass }, 404);
  }
  return c.json({
    country: row.country,
    taxClass: row.taxClass,
    rate: row.rate,
    label: row.label,
    validFrom: row.validFrom,
  });
});

// ════════════════════════════════════════════════════════════════
// 2. Ledger — lijst + aggregaties
// ════════════════════════════════════════════════════════════════

const ledgerListSchema = z.object({
  shop_id: z.string().uuid().optional(),
  order_id: z.string().uuid().optional(),
  account: z.string().trim().min(1).optional(),
  channel: z.string().trim().min(1).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

financeRoutes.get('/ledger', async (c) => {
  const parsed = ledgerListSchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { shop_id, order_id, account, channel, from, to, limit, offset } = parsed.data;
  const conds = [];
  if (shop_id) conds.push(eq(ledgerEntries.shopId, shop_id));
  if (order_id) conds.push(eq(ledgerEntries.orderId, order_id));
  if (account) conds.push(eq(ledgerEntries.account, account));
  if (channel) conds.push(eq(ledgerEntries.channel, channel));
  if (from) conds.push(gte(ledgerEntries.entryDate, from));
  if (to) conds.push(lte(ledgerEntries.entryDate, to));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(where)
    .orderBy(desc(ledgerEntries.entryDate), desc(ledgerEntries.createdAt))
    .limit(limit)
    .offset(offset);

  const totalRes = await db.select({ c: count() }).from(ledgerEntries).where(where);
  return c.json({
    items: rows.map(toLedgerEntryDto),
    total: Number(totalRes[0]?.c ?? 0),
    limit,
    offset,
  });
});

const ledgerAggSchema = z.object({
  shop_id: z.string().uuid().optional(),
  channel: z.string().trim().min(1).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period: PeriodSchema.default('month'),
  /** Bron: 'orders' (afgeleid uit orders+items) of 'ledger' (uit ledger_entries). */
  source: z.enum(['orders', 'ledger']).default('orders'),
});

/**
 * GET /api/finance/ledger/aggregate
 * Omzet / marge / BTW per shop + kanaal + periode-bucket.
 *
 * source=orders  → leidt af uit `orders` (+ order_items voor COGS/marge).
 * source=ledger  → telt debit/credit per account uit `ledger_entries`.
 *
 * Alle sommen in hele centen → geen float-drift; output als Money-string.
 */
financeRoutes.get('/ledger/aggregate', async (c) => {
  const parsed = ledgerAggSchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { shop_id, channel, from, to, period, source } = parsed.data;

  if (source === 'ledger') {
    const conds = [];
    if (shop_id) conds.push(eq(ledgerEntries.shopId, shop_id));
    if (channel) conds.push(eq(ledgerEntries.channel, channel));
    if (from) conds.push(gte(ledgerEntries.entryDate, from));
    if (to) conds.push(lte(ledgerEntries.entryDate, to));
    const where = conds.length > 0 ? and(...conds) : undefined;

    const bucket = dateBucket(ledgerEntries.entryDate, period);
    const rows = await db
      .select({
        period: bucket,
        shopId: ledgerEntries.shopId,
        channel: ledgerEntries.channel,
        account: ledgerEntries.account,
        debit: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)`,
      })
      .from(ledgerEntries)
      .where(where)
      .groupBy(bucket, ledgerEntries.shopId, ledgerEntries.channel, ledgerEntries.account)
      .orderBy(bucket);

    // Bundel per (period, shop, channel) en map accounts naar centen.
    type Bucket = {
      period: string;
      shopId: string | null;
      channel: string | null;
      revenueCents: number;
      vatCents: number;
      cogsCents: number;
    };
    const map = new Map<string, Bucket>();
    for (const r of rows) {
      const key = `${r.period}|${r.shopId ?? ''}|${r.channel ?? ''}`;
      const b =
        map.get(key) ??
        { period: r.period, shopId: r.shopId, channel: r.channel, revenueCents: 0, vatCents: 0, cogsCents: 0 };
      // revenue = credit−debit op 'revenue'; vat op 'vat_payable'; cogs op 'cogs'
      const net = toCents(r.credit) - toCents(r.debit);
      if (r.account === 'revenue') b.revenueCents += net;
      else if (r.account === 'vat_payable') b.vatCents += net;
      else if (r.account === 'cogs') b.cogsCents += toCents(r.debit) - toCents(r.credit);
      map.set(key, b);
    }
    const items = [...map.values()].map((b) => ({
      period: b.period,
      shopId: b.shopId,
      channel: b.channel,
      revenue: centsToMoney(b.revenueCents),
      vat: centsToMoney(b.vatCents),
      cogs: centsToMoney(b.cogsCents),
      margin: centsToMoney(marginCents(b.revenueCents, b.cogsCents)),
      marginPct: marginPct(b.revenueCents, b.cogsCents),
    }));
    return c.json({ source, period, items, total: items.length });
  }

  // ── source = 'orders' ──────────────────────────────────────
  const conds = [];
  if (shop_id) conds.push(eq(orders.shopId, shop_id));
  if (channel) conds.push(eq(orders.channel, channel));
  // alleen betaalde/afgeronde orders tellen mee als omzet
  conds.push(inArray(orders.financialStatus, ['paid', 'partially_refunded', 'refunded']));
  if (from) conds.push(gte(orders.createdAt, sql`${from}::timestamptz`));
  if (to) conds.push(lte(orders.createdAt, sql`(${to}::date + 1)::timestamptz`));
  const where = and(...conds);

  const bucket = dateBucket(orders.createdAt, period);
  const rows = await db
    .select({
      period: bucket,
      shopId: orders.shopId,
      channel: orders.channel,
      subtotal: sql<string>`coalesce(sum(${orders.subtotal}), 0)`,
      tax: sql<string>`coalesce(sum(${orders.taxTotal}), 0)`,
      shipping: sql<string>`coalesce(sum(${orders.shippingTotal}), 0)`,
      grand: sql<string>`coalesce(sum(${orders.grandTotal}), 0)`,
      orderCount: count(),
    })
    .from(orders)
    .where(where)
    .groupBy(bucket, orders.shopId, orders.channel)
    .orderBy(bucket);

  // COGS per dezelfde groep — join order_items op orders. We halen de COGS los
  // op (sum(cost_price × quantity)) en mappen via dezelfde sleutel.
  const cogsRows = await db
    .select({
      period: bucket,
      shopId: orders.shopId,
      channel: orders.channel,
      cogs: sql<string>`coalesce(sum(${orderItems.costPrice} * ${orderItems.quantity}), 0)`,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(where)
    .groupBy(bucket, orders.shopId, orders.channel);

  const cogsByKey = new Map<string, number>();
  for (const r of cogsRows) {
    cogsByKey.set(`${r.period}|${r.shopId ?? ''}|${r.channel ?? ''}`, toCents(r.cogs));
  }

  const items = rows.map((r) => {
    const key = `${r.period}|${r.shopId ?? ''}|${r.channel ?? ''}`;
    const revenueNet = toCents(r.subtotal); // subtotal = excl. BTW (zie orders-schema)
    const cogs = cogsByKey.get(key) ?? 0;
    return {
      period: r.period,
      shopId: r.shopId,
      channel: r.channel,
      orderCount: Number(r.orderCount),
      revenue: centsToMoney(revenueNet),
      vat: centsToMoney(toCents(r.tax)),
      shipping: centsToMoney(toCents(r.shipping)),
      grossTotal: centsToMoney(toCents(r.grand)),
      cogs: centsToMoney(cogs),
      margin: centsToMoney(marginCents(revenueNet, cogs)),
      marginPct: marginPct(revenueNet, cogs),
    };
  });

  return c.json({ source, period, items, total: items.length });
});

// ════════════════════════════════════════════════════════════════
// 3. P&L-overzicht (omzet / COGS / marge / BTW) per shop+periode
// ════════════════════════════════════════════════════════════════

const pnlSchema = z.object({
  shop_id: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

financeRoutes.get('/pnl', async (c) => {
  const parsed = pnlSchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { shop_id, from, to } = parsed.data;

  const conds = [];
  if (shop_id) conds.push(eq(orders.shopId, shop_id));
  conds.push(inArray(orders.financialStatus, ['paid', 'partially_refunded', 'refunded']));
  if (from) conds.push(gte(orders.createdAt, sql`${from}::timestamptz`));
  if (to) conds.push(lte(orders.createdAt, sql`(${to}::date + 1)::timestamptz`));
  const where = and(...conds);

  const [head] = await db
    .select({
      orderCount: count(),
      subtotal: sql<string>`coalesce(sum(${orders.subtotal}), 0)`,
      tax: sql<string>`coalesce(sum(${orders.taxTotal}), 0)`,
      shipping: sql<string>`coalesce(sum(${orders.shippingTotal}), 0)`,
      discount: sql<string>`coalesce(sum(${orders.discountTotal}), 0)`,
      grand: sql<string>`coalesce(sum(${orders.grandTotal}), 0)`,
    })
    .from(orders)
    .where(where);

  const [cogsRow] = await db
    .select({
      cogs: sql<string>`coalesce(sum(${orderItems.costPrice} * ${orderItems.quantity}), 0)`,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(where);

  const revenueNet = toCents(head?.subtotal);
  const vat = toCents(head?.tax);
  const shipping = toCents(head?.shipping);
  const discount = toCents(head?.discount);
  const cogs = toCents(cogsRow?.cogs);
  const grossMargin = marginCents(revenueNet, cogs);

  return c.json({
    shopId: shop_id ?? null,
    period: { from: from ?? null, to: to ?? null },
    orderCount: Number(head?.orderCount ?? 0),
    revenueNet: centsToMoney(revenueNet),
    discount: centsToMoney(discount),
    shipping: centsToMoney(shipping),
    cogs: centsToMoney(cogs),
    grossMargin: centsToMoney(grossMargin),
    grossMarginPct: marginPct(revenueNet, cogs),
    vat: centsToMoney(vat),
    grandTotal: centsToMoney(toCents(head?.grand)),
  });
});

// ════════════════════════════════════════════════════════════════
// 4. Invoices — list / detail / generate-from-order
// ════════════════════════════════════════════════════════════════

const invoiceListSchema = z.object({
  shop_id: z.string().uuid().optional(),
  status: z.string().trim().min(1).optional(),
  type: z.enum(['sales', 'credit']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

financeRoutes.get('/invoices', async (c) => {
  const parsed = invoiceListSchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { shop_id, status, type, limit, offset } = parsed.data;
  const conds = [];
  if (shop_id) conds.push(eq(invoices.shopId, shop_id));
  if (status) conds.push(eq(invoices.status, status));
  if (type) conds.push(eq(invoices.type, type));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select()
    .from(invoices)
    .where(where)
    .orderBy(desc(invoices.issuedAt))
    .limit(limit)
    .offset(offset);
  const totalRes = await db.select({ c: count() }).from(invoices).where(where);
  return c.json({
    items: rows.map(toInvoiceDto),
    total: Number(totalRes[0]?.c ?? 0),
    limit,
    offset,
  });
});

financeRoutes.get('/invoices/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ invoice: { ...toInvoiceDto(row), ublXml: row.ublXml } });
});

const generateInvoiceSchema = z.object({
  order_id: z.string().uuid(),
  type: z.enum(['sales', 'credit']).default('sales'),
  /** Optioneel expliciet factuurnummer; anders auto INV-<n> per shop. */
  invoice_number: z.string().trim().min(1).max(64).optional(),
});

/**
 * POST /api/finance/invoices/generate
 * Genereert een invoice uit een bestaande order. Lines worden gesnapshot in
 * `invoices.lines` (jsonb). Subtotaal/BTW/totaal uit de order-totalen.
 * Idempotent-vriendelijk: bestaat er al een sales-invoice voor de order, dan
 * 409 met de bestaande id (tenzij type=credit).
 */
financeRoutes.post('/invoices/generate', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = generateInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { order_id, type, invoice_number } = parsed.data;

  const [order] = await db.select().from(orders).where(eq(orders.id, order_id)).limit(1);
  if (!order) return c.json({ error: 'order_not_found' }, 404);

  if (type === 'sales') {
    const [existing] = await db
      .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(and(eq(invoices.orderId, order_id), eq(invoices.type, 'sales')))
      .limit(1);
    if (existing) {
      return c.json(
        { error: 'invoice_exists', invoiceId: existing.id, invoiceNumber: existing.invoiceNumber },
        409,
      );
    }
  }

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order_id));

  // Factuurnummer bepalen: expliciet, anders per-shop oplopend INV-<n>.
  let number = invoice_number;
  if (!number) {
    const [{ c: cnt } = { c: 0 }] = await db
      .select({ c: count() })
      .from(invoices)
      .where(eq(invoices.shopId, order.shopId));
    const seq = Number(cnt) + 1;
    number = `INV-${order.orderNumber}-${String(seq).padStart(4, '0')}`;
  }

  // Lines snapshotten + per-tarief BTW-subtotalen (centen).
  const lines = items.map((it, idx) => {
    const lineNetCents = toCents(it.lineTotal);
    const taxCents = toCents(it.taxAmount);
    return {
      id: idx + 1,
      sku: it.sku,
      title: it.title,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      taxRate: Number(it.taxRate),
      taxAmount: it.taxAmount,
      lineTotal: it.lineTotal,
      _netCents: lineNetCents,
      _taxCents: taxCents,
    };
  });

  const subtotalCents = toCents(order.subtotal);
  const vatCents = toCents(order.taxTotal);
  const totalCents = toCents(order.grandTotal);
  const sign = type === 'credit' ? -1 : 1;

  const customer = {
    name:
      order.billingAddress?.name ??
      [order.billingAddress?.company].filter(Boolean).join(' ') ??
      order.email ??
      undefined,
    company: order.billingAddress?.company,
    email: order.email ?? undefined,
    address: order.billingAddress
      ? {
          line1: order.billingAddress.line1,
          line2: order.billingAddress.line2,
          postcode: order.billingAddress.postcode,
          city: order.billingAddress.city,
          province: order.billingAddress.province,
          country: order.billingAddress.country,
        }
      : undefined,
  };

  const [inserted] = await db
    .insert(invoices)
    .values({
      shopId: order.shopId,
      orderId: order.id,
      invoiceNumber: number,
      type,
      customer,
      lines: lines.map(({ _netCents, _taxCents, ...rest }) => {
        void _netCents;
        void _taxCents;
        return rest;
      }),
      subtotal: centsToMoney(sign * subtotalCents),
      vatTotal: centsToMoney(sign * vatCents),
      total: centsToMoney(sign * totalCents),
      status: 'issued',
    })
    .onConflictDoNothing({ target: [invoices.shopId, invoices.invoiceNumber] })
    .returning();

  if (!inserted) {
    return c.json({ error: 'invoice_number_conflict', invoiceNumber: number }, 409);
  }

  logger.info({ invoiceId: inserted.id, orderId: order_id, type }, 'invoice generated');
  return c.json({ invoice: toInvoiceDto(inserted) }, 201);
});

// ════════════════════════════════════════════════════════════════
// 5. Exports — UBL 2.1-XML + OSS-CSV
// ════════════════════════════════════════════════════════════════

const ublExportSchema = z.object({
  invoice_id: z.string().uuid(),
  /** Verkoper-gegevens (shop). V1 optioneel; anders shop-naam als fallback. */
  supplier: z
    .object({
      name: z.string().optional(),
      vatNumber: z.string().optional(),
      street: z.string().optional(),
      city: z.string().optional(),
      postcode: z.string().optional(),
      country: z.string().length(2).optional(),
      email: z.string().optional(),
    })
    .optional(),
  /** persist=true slaat de XML op in invoices.ubl_xml. */
  persist: z.boolean().default(true),
});

/**
 * POST /api/finance/exports/ubl
 * Genereert geldige UBL 2.1 (SI-UBL/NLCIUS) XML uit een opgeslagen invoice.
 * Slaat (default) de XML op in `invoices.ubl_xml`. Geeft de XML terug als string.
 */
financeRoutes.post('/exports/ubl', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ublExportSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { invoice_id, persist } = parsed.data;

  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoice_id)).limit(1);
  if (!inv) return c.json({ error: 'invoice_not_found' }, 404);

  const [shop] = await db.select().from(shops).where(eq(shops.id, inv.shopId)).limit(1);

  // Lines → UBL-lines (netto). order_items.lineTotal = excl. BTW (line net).
  const rawLines = (inv.lines as Array<Record<string, unknown>>) ?? [];
  const ublLines: UblLine[] = rawLines.map((l, idx) => {
    const qty = Number(l.quantity ?? 1) || 1;
    const lineNet2 = money2((l.lineTotal as string) ?? '0');
    const unitNet2 = money2((l.unitPrice as string) ?? '0');
    return {
      id: (l.id as string | number) ?? idx + 1,
      description: (l.title as string) ?? (l.sku as string) ?? `Regel ${idx + 1}`,
      quantity: qty,
      unitPriceNet: unitNet2,
      lineNet: lineNet2,
      vatRate: Number(l.taxRate ?? 21),
    };
  });

  // Per-tarief BTW-subtotalen uit de lines.
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const l of rawLines) {
    const rate = Number(l.taxRate ?? 21);
    const agg = byRate.get(rate) ?? { taxable: 0, tax: 0 };
    agg.taxable += toCents((l.lineTotal as string) ?? '0');
    agg.tax += toCents((l.taxAmount as string) ?? '0');
    byRate.set(rate, agg);
  }
  const taxSubtotals = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({
      rate,
      taxable: money2(centsToMoney(v.taxable)),
      tax: money2(centsToMoney(v.tax)),
    }));

  const supplierInput = parsed.data.supplier;
  const ublInput: UblInvoiceInput = {
    invoiceNumber: inv.invoiceNumber,
    issueDate: inv.issuedAt.toISOString().slice(0, 10),
    currency: 'EUR',
    type: inv.type === 'credit' ? 'credit' : 'sales',
    supplier: {
      name: supplierInput?.name ?? shop?.name ?? 'Webshop',
      vatNumber: supplierInput?.vatNumber,
      street: supplierInput?.street,
      city: supplierInput?.city,
      postcode: supplierInput?.postcode,
      country: supplierInput?.country ?? shop?.vatConfig?.defaultCountry ?? 'NL',
      email: supplierInput?.email ?? shop?.supportEmail ?? undefined,
    },
    customer: {
      name: inv.customer?.name ?? inv.customer?.company ?? 'Klant',
      vatNumber: inv.customer?.vatNumber,
      street: inv.customer?.address?.line1,
      city: inv.customer?.address?.city,
      postcode: inv.customer?.address?.postcode,
      country: inv.customer?.address?.country ?? 'NL',
      email: inv.customer?.email,
    },
    lines: ublLines,
    taxExclusive: money2(inv.subtotal),
    taxAmount: money2(inv.vatTotal),
    taxInclusive: money2(inv.total),
    taxSubtotals:
      taxSubtotals.length > 0
        ? taxSubtotals
        : [{ rate: 21, taxable: money2(inv.subtotal), tax: money2(inv.vatTotal) }],
  };

  const xml = generateUblInvoice(ublInput);
  if (!isWellFormedXml(xml)) {
    logger.error({ invoiceId: invoice_id }, 'generated UBL not well-formed');
    return c.json({ error: 'ubl_generation_failed' }, 500);
  }

  if (persist) {
    await db.update(invoices).set({ ublXml: xml }).where(eq(invoices.id, invoice_id));
  }

  c.header('Content-Type', 'application/xml; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${inv.invoiceNumber}.xml"`);
  return c.body(xml);
});

const ossExportSchema = z.object({
  period: z.string().trim().regex(/^\d{4}-Q[1-4]$/, 'period moet YYYY-Q[1-4] zijn'),
  shop_id: z.string().uuid().optional(),
  /** Optioneel: expliciete rows (mock/override). Anders afgeleid uit ledger. */
  rows: z
    .array(
      z.object({
        country: z.string().length(2),
        vatRate: z.number(),
        taxableBase: z.string(),
        vatAmount: z.string(),
      }),
    )
    .optional(),
});

/**
 * POST /api/finance/exports/oss
 * OSS-CSV per (land van consumptie, BTW-tarief) over een kwartaal. V1: leidt af
 * uit `ledger_entries` (vat_country + vat_rate) of accepteert expliciete rows.
 */
financeRoutes.post('/exports/oss', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ossExportSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { period, shop_id } = parsed.data;

  let rows: OssRow[] = parsed.data.rows ?? [];

  if (rows.length === 0) {
    // Afleiden uit ledger_entries: groepeer op (vat_country, vat_rate).
    // Belastbaar = som revenue-net; BTW = som vat_payable.
    const [yearStr, qStr] = period.split('-Q');
    const year = Number(yearStr);
    const q = Number(qStr);
    const fromMonth = (q - 1) * 3 + 1;
    const from = `${year}-${String(fromMonth).padStart(2, '0')}-01`;
    const toMonth = fromMonth + 2;
    // Laatste dag van de kwartaal-eind-maand. Hardcoded '-31' was ongeldig voor
    // Q2 (juni) en Q3 (sept) → Postgres-fout/500. Dag 0 van de VOLGENDE maand =
    // laatste dag van toMonth (toMonth is 1-based; Date.UTC-maand is 0-based).
    const lastDay = new Date(Date.UTC(year, toMonth, 0)).getUTCDate();
    const to = `${year}-${String(toMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const conds = [gte(ledgerEntries.entryDate, from), lte(ledgerEntries.entryDate, to)];
    if (shop_id) conds.push(eq(ledgerEntries.shopId, shop_id));

    const agg = await db
      .select({
        country: ledgerEntries.vatCountry,
        rate: ledgerEntries.vatRate,
        account: ledgerEntries.account,
        debit: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)`,
      })
      .from(ledgerEntries)
      .where(and(...conds))
      .groupBy(ledgerEntries.vatCountry, ledgerEntries.vatRate, ledgerEntries.account);

    const byKey = new Map<string, { country: string; rate: number; baseCents: number; vatCents: number }>();
    for (const r of agg) {
      if (!r.country || r.rate == null) continue;
      const rate = Number(r.rate);
      const key = `${r.country}|${rate}`;
      const e = byKey.get(key) ?? { country: r.country, rate, baseCents: 0, vatCents: 0 };
      if (r.account === 'revenue') e.baseCents += toCents(r.credit) - toCents(r.debit);
      else if (r.account === 'vat_payable') e.vatCents += toCents(r.credit) - toCents(r.debit);
      byKey.set(key, e);
    }
    rows = [...byKey.values()].map((e) => ({
      country: e.country,
      vatRate: e.rate,
      taxableBase: money2(centsToMoney(e.baseCents)),
      vatAmount: money2(centsToMoney(e.vatCents)),
    }));
  }

  const csv = generateOssCsv({ period, rows });
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="oss-${period}.csv"`);
  return c.body(csv);
});
