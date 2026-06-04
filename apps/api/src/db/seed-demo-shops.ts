/**
 * Demo-shops-seed — 2 complete, realistische shops met gepubliceerde producten,
 * CMS-content, klanten, orders en grootboek-posten. Voedt de storefronts (Wave 3)
 * EN de admin-dashboards.
 *
 *   Run: `pnpm --filter @webshop-crm/api seed:demo-shops`
 *   (of vanaf root: `pnpm db:seed-demo-shops`)
 *
 * Idempotent: als shop-slug 'crema' al bestaat → log + exit 0 (geen duplicates).
 *
 * Voorwaarden:
 *   - default-location 'main' bestaat        (`pnpm db:seed`)
 *   - 50 demo-producten + variants + inventory (`pnpm db:seed-demo`)
 *
 * Wat wordt geseed (per shop):
 *   - 1 shop (branding + vatConfig + default_location)
 *   - ~20 gepubliceerde producten (shop_products, sommige met price_override)
 *   - 1 homepage + 1 over-ons (cms_pages, published, blocks + seo)
 *   - 1 header-menu + 4 menu-items (cms_menus + cms_menu_items)
 *   - 2-3 blog-posts (blog_posts, published)
 *   - 6-8 customers (NL namen/emails, 1-2 B2B met vat_number+company)
 *   - 8-12 orders met 1-3 order_items (echte variant-id's + sku + prijzen),
 *     verspreid over de afgelopen ~30 dagen
 *   - 1 order_payment per betaalde order
 *   - 2-3 ledger_entries per betaalde order (revenue / vat_payable / cogs)
 */
import { eq, inArray, asc } from 'drizzle-orm';
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import {
  shops,
  shopProducts,
  cmsPages,
  cmsMenus,
  cmsMenuItems,
  blogPosts,
  customers,
  orders,
  orderItems,
  orderPayments,
  ledgerEntries,
  products,
  variants,
  locations,
} from './schema/index.js';

// ─── Helpers ──────────────────────────────────────────────────

const VAT_RATE = 21; // %
const VAT_FACTOR = 0.21;

/** Geld-string met 2 decimalen (numeric(12,4) accepteert dit). */
function money(n: number): string {
  return n.toFixed(2);
}

/** Datum = nu minus `days` dagen (deterministisch). */
function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/** ISO-date (yyyy-mm-dd) voor de `date`-kolom van ledger_entries. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Deterministische pseudo-random in [0,1) op basis van een integer-seed. */
function rand01(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function randInt(min: number, max: number, seed: number): number {
  return Math.floor(min + rand01(seed) * (max - min + 1));
}

// ─── Shop-definities ──────────────────────────────────────────

type ShopDef = {
  slug: string;
  name: string;
  domain: string;
  branding: Record<string, unknown>;
  supportEmail: string;
  orderPrefix: string; // 'CR' / 'PF'
  customers: Array<{
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    company?: string;
    vatNumber?: string;
    city: string;
    line1: string;
    postcode: string;
  }>;
  pages: {
    homeTitle: string;
    homeIntro: string;
    aboutBody: string;
  };
  blog: Array<{ slug: string; title: string; excerpt: string; body: string; tags: string[] }>;
};

const VAT_CONFIG = { priceIncludesVat: true, defaultCountry: 'NL', oss: false };

const SHOP_DEFS: ShopDef[] = [
  {
    slug: 'crema',
    name: 'Crema & Co.',
    domain: 'crema.local',
    branding: { primaryColor: '#6f4e37', accentColor: '#c8862a', theme: 'coffee' },
    supportEmail: 'hallo@crema.local',
    orderPrefix: 'CR',
    customers: [
      { firstName: 'Sanne', lastName: 'de Vries', email: 'sanne.devries@example.nl', phone: '+31 6 12345678', city: 'Utrecht', line1: 'Oudegracht 12', postcode: '3511 AB' },
      { firstName: 'Lars', lastName: 'Bakker', email: 'lars.bakker@example.nl', phone: '+31 6 22334455', city: 'Amsterdam', line1: 'Prinsengracht 88', postcode: '1015 DZ' },
      { firstName: 'Emma', lastName: 'Jansen', email: 'emma.jansen@example.nl', city: 'Rotterdam', line1: 'Coolsingel 40', postcode: '3011 AD' },
      { firstName: 'Daan', lastName: 'Visser', email: 'daan.visser@example.nl', phone: '+31 6 33445566', city: 'Den Haag', line1: 'Lange Voorhout 7', postcode: '2514 EA' },
      { firstName: 'Lotte', lastName: 'Smit', email: 'lotte.smit@example.nl', city: 'Eindhoven', line1: 'Stratumseind 22', postcode: '5611 ET' },
      { firstName: 'Koffiehuis', lastName: 'Centraal', email: 'inkoop@koffiehuiscentraal.nl', company: 'Koffiehuis Centraal B.V.', vatNumber: 'NL001234567B01', phone: '+31 30 1234567', city: 'Utrecht', line1: 'Stationsplein 1', postcode: '3511 LL' },
      { firstName: 'Brasserie', lastName: 'De Hoek', email: 'admin@brasseriedehoek.nl', company: 'Brasserie De Hoek V.O.F.', vatNumber: 'NL002345678B01', phone: '+31 20 7654321', city: 'Amsterdam', line1: 'Spuistraat 210', postcode: '1012 VT' },
    ],
    pages: {
      homeTitle: 'Crema & Co. — Versgebrande koffie',
      homeIntro: 'Welkom bij Crema & Co. Wij branden dagvers en leveren espressomachines, molens en bonen voor de echte liefhebber.',
      aboutBody: '<h2>Over Crema & Co.</h2><p>Sinds 2018 branden wij ambachtelijk koffie in kleine batches. Van single-origin tot huisblends, en alle apparatuur om er thuis het beste van te maken.</p><p>Onze missie: betaalbare specialty-koffie voor iedereen.</p>',
    },
    blog: [
      { slug: 'perfecte-espresso', title: 'Zo zet je de perfecte espresso', excerpt: 'De 4 variabelen die het verschil maken tussen bitter en briljant.', body: '<p>Maling, dosering, temperatuur en tijd — beheers deze vier en je espresso wordt altijd goed.</p>', tags: ['espresso', 'tips'] },
      { slug: 'bonen-bewaren', title: 'Koffiebonen bewaren: do’s en don’ts', excerpt: 'Lucht, licht en vocht zijn de vijanden van je bonen.', body: '<p>Bewaar bonen luchtdicht, donker en op kamertemperatuur. Niet in de vriezer.</p>', tags: ['bonen', 'bewaren'] },
      { slug: 'melk-opschuimen', title: 'Microfoam: melk opschuimen als een barista', excerpt: 'Zijdezachte melk voor je cappuccino in 3 stappen.', body: '<p>Begin met koude volle melk, breng lucht in tijdens de eerste seconden en roll daarna.</p>', tags: ['melk', 'latte-art'] },
    ],
  },
  {
    slug: 'pawfect',
    name: 'Pawfect',
    domain: 'pawfect.local',
    branding: { primaryColor: '#2e7d52', accentColor: '#7bc47f', theme: 'pet' },
    supportEmail: 'hallo@pawfect.local',
    orderPrefix: 'PF',
    customers: [
      { firstName: 'Noa', lastName: 'van Dijk', email: 'noa.vandijk@example.nl', phone: '+31 6 44556677', city: 'Groningen', line1: 'Herestraat 50', postcode: '9711 LD' },
      { firstName: 'Tim', lastName: 'Meijer', email: 'tim.meijer@example.nl', city: 'Nijmegen', line1: 'Marikenstraat 18', postcode: '6511 PS' },
      { firstName: 'Julia', lastName: 'Mulder', email: 'julia.mulder@example.nl', phone: '+31 6 55667788', city: 'Haarlem', line1: 'Grote Houtstraat 99', postcode: '2011 SR' },
      { firstName: 'Sem', lastName: 'de Boer', email: 'sem.deboer@example.nl', city: 'Tilburg', line1: 'Heuvelstraat 5', postcode: '5038 AA' },
      { firstName: 'Mila', lastName: 'Hendriks', email: 'mila.hendriks@example.nl', phone: '+31 6 66778899', city: 'Breda', line1: 'Ginnekenstraat 31', postcode: '4811 JC' },
      { firstName: 'Finn', lastName: 'Kuijpers', email: 'finn.kuijpers@example.nl', city: 'Arnhem', line1: 'Vijzelstraat 8', postcode: '6811 GT' },
      { firstName: 'Dierenkliniek', lastName: 'De Brug', email: 'balie@dierenkliniekdebrug.nl', company: 'Dierenkliniek De Brug B.V.', vatNumber: 'NL003456789B01', phone: '+31 26 3456789', city: 'Arnhem', line1: 'Velperweg 120', postcode: '6824 HJ' },
      { firstName: 'Pension', lastName: 'Vrolijke Poot', email: 'info@vrolijkepoot.nl', company: 'Pension Vrolijke Poot', vatNumber: 'NL004567890B01', phone: '+31 50 9876543', city: 'Groningen', line1: 'Hoendiep 200', postcode: '9743 BD' },
    ],
    pages: {
      homeTitle: 'Pawfect — Alles voor je huisdier',
      homeIntro: 'Welkom bij Pawfect. Premium voer, verzorging en speelgoed voor honden en katten — met advies van dierenliefhebbers.',
      aboutBody: '<h2>Over Pawfect</h2><p>Pawfect begon als kleine dierenspeciaalzaak en groeide uit tot een complete webshop. Wij selecteren alleen voer en accessoires die we onze eigen huisdieren ook geven.</p><p>Gratis verzending vanaf €35 en advies op maat.</p>',
    },
    blog: [
      { slug: 'puppy-voeding', title: 'Puppy voeding: waar moet je op letten?', excerpt: 'De eerste maanden bepalen de gezondheid van je hond.', body: '<p>Kies voer dat is afgestemd op leeftijd en ras. Verdeel over meerdere kleine porties per dag.</p>', tags: ['hond', 'voeding'] },
      { slug: 'kat-binnen-actief', title: '5 manieren om je binnenkat actief te houden', excerpt: 'Verveling voorkomen met spel en klimplekken.', body: '<p>Krabpalen, puzzelvoer en dagelijks 10 minuten spel houden je kat fit en gelukkig.</p>', tags: ['kat', 'speelgoed'] },
    ],
  },
];

// ─── Idempotentie-check ───────────────────────────────────────

async function cremaExists(): Promise<boolean> {
  const rows = await db.select({ id: shops.id }).from(shops).where(eq(shops.slug, 'crema')).limit(1);
  return rows.length > 0;
}

async function getMainLocationId(): Promise<string> {
  const rows = await db.select().from(locations).where(eq(locations.code, 'main')).limit(1);
  if (rows.length === 0) {
    throw new Error("default-location 'main' bestaat niet — run eerst `pnpm db:seed`.");
  }
  return rows[0]!.id;
}

// ─── Catalogus laden ──────────────────────────────────────────

type PublishableProduct = {
  productId: string;
  variantId: string;
  sku: string;
  price: string;
  costPrice: string | null;
  title: string;
};

/**
 * Haalt de demo-producten op (slug LIKE 'demo-%') met hun eerste variant.
 * We gebruiken de eerste active variant per product (positie 0) voor orders.
 */
async function loadCatalog(): Promise<{ productIds: string[]; firstVariant: Map<string, PublishableProduct> }> {
  const prodRows = await db
    .select({ id: products.id, title: products.title, slug: products.slug })
    .from(products)
    .orderBy(asc(products.slug));

  const productIds = prodRows.map((p) => p.id);
  const titleById = new Map(prodRows.map((p) => [p.id, p.title]));

  if (productIds.length === 0) {
    throw new Error('Geen producten gevonden — run eerst `pnpm db:seed-demo`.');
  }

  const varRows = await db
    .select({
      id: variants.id,
      productId: variants.productId,
      sku: variants.sku,
      price: variants.price,
      costPrice: variants.costPrice,
      position: variants.position,
      active: variants.active,
    })
    .from(variants)
    .where(inArray(variants.productId, productIds))
    .orderBy(asc(variants.productId), asc(variants.position));

  // eerste active variant per product (laagste positie)
  const firstVariant = new Map<string, PublishableProduct>();
  for (const v of varRows) {
    if (!v.active) continue;
    if (firstVariant.has(v.productId)) continue;
    firstVariant.set(v.productId, {
      productId: v.productId,
      variantId: v.id,
      sku: v.sku,
      price: v.price,
      costPrice: v.costPrice,
      title: titleById.get(v.productId) ?? 'Product',
    });
  }

  return { productIds, firstVariant };
}

// ─── Seed-flow per shop ───────────────────────────────────────

async function seedShop(
  def: ShopDef,
  shopIndexBase: number,
  mainLocationId: string,
  catalog: { productIds: string[]; firstVariant: Map<string, PublishableProduct> },
): Promise<{
  publishedProducts: number;
  customers: number;
  orders: number;
  paidOrders: number;
  orderItems: number;
  ledgerEntries: number;
  pages: number;
  blogPosts: number;
  menuItems: number;
}> {
  // 1. Shop
  const [shop] = await db
    .insert(shops)
    .values({
      slug: def.slug,
      name: def.name,
      domain: def.domain,
      locale: 'nl-NL',
      currency: 'EUR',
      status: 'active',
      branding: def.branding,
      vatConfig: VAT_CONFIG,
      defaultLocationId: mainLocationId,
      supportEmail: def.supportEmail,
    })
    .returning({ id: shops.id });
  const shopId = shop!.id;

  // 2. Producten publiceren — verdeel de catalogus.
  // shopIndexBase 0 → eerste helft, 1 → tweede helft (mag overlappen niet nodig).
  const allIds = catalog.productIds;
  const half = Math.ceil(allIds.length / 2);
  const slice = shopIndexBase === 0 ? allIds.slice(0, Math.min(20, half + 5)) : allIds.slice(Math.max(0, allIds.length - Math.min(20, half + 5)));
  // pak 20 (of zoveel als er zijn)
  const toPublish = slice.slice(0, 20);

  let position = 0;
  const publishedVariants: PublishableProduct[] = [];
  for (const productId of toPublish) {
    const pv = catalog.firstVariant.get(productId);
    // price_override op ~elke 4e
    const override = position % 4 === 1 && pv ? money(Math.round((Number(pv.price) * 0.9) * 100) / 100) : null;
    await db.insert(shopProducts).values({
      shopId,
      productId,
      published: true,
      priceOverride: override,
      position,
      publishedAt: daysAgo(40 - (position % 30)),
    });
    if (pv) publishedVariants.push(pv);
    position++;
  }

  // 3. CMS — homepage + over-ons
  await db.insert(cmsPages).values({
    shopId,
    slug: 'home',
    title: def.pages.homeTitle,
    status: 'published',
    template: 'default',
    blocks: [
      { type: 'hero', heading: def.name, subheading: def.pages.homeIntro, cta: { label: 'Shop nu', url: '/shop' } },
      { type: 'richtext', html: `<p>${def.pages.homeIntro}</p>` },
      { type: 'product-grid', title: 'Uitgelicht', source: 'published', limit: 8 },
    ],
    seo: { title: def.pages.homeTitle, description: def.pages.homeIntro.slice(0, 155) },
    publishedAt: daysAgo(45),
  });

  await db.insert(cmsPages).values({
    shopId,
    slug: 'over-ons',
    title: `Over ${def.name}`,
    status: 'published',
    template: 'default',
    blocks: [{ type: 'richtext', html: def.pages.aboutBody }],
    seo: { title: `Over ${def.name}`, description: `Maak kennis met ${def.name}.` },
    publishedAt: daysAgo(45),
  });

  // header-menu + items
  const [menu] = await db
    .insert(cmsMenus)
    .values({ shopId, location: 'header', name: 'Hoofdmenu' })
    .returning({ id: cmsMenus.id });
  const menuId = menu!.id;
  const menuItems = [
    { label: 'Home', url: '/' },
    { label: 'Shop', url: '/shop' },
    { label: 'Blog', url: '/blog' },
    { label: 'Over ons', url: '/over-ons' },
  ];
  let mPos = 0;
  for (const it of menuItems) {
    await db.insert(cmsMenuItems).values({ menuId, label: it.label, url: it.url, position: mPos });
    mPos++;
  }

  // blog-posts
  let blogPos = 0;
  for (const post of def.blog) {
    await db.insert(blogPosts).values({
      shopId,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      bodyHtml: post.body,
      status: 'published',
      author: def.name,
      tags: post.tags,
      seo: { title: post.title, description: post.excerpt },
      publishedAt: daysAgo(20 - blogPos * 5),
    });
    blogPos++;
  }

  // 4. Customers
  const customerIds: string[] = [];
  for (const c of def.customers) {
    const isB2B = !!c.company;
    const [cust] = await db
      .insert(customers)
      .values({
        shopId,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone ?? null,
        company: c.company ?? null,
        vatNumber: c.vatNumber ?? null,
        acceptsMarketing: !isB2B,
        tags: isB2B ? ['b2b'] : ['retail'],
      })
      .returning({ id: customers.id });
    customerIds.push(cust!.id);
  }

  // 5. Orders + order_items + payments + ledger
  // Statussen-verdeling voor ~10 orders.
  const ORDER_STATUSES: Array<{ status: string; paid: boolean; fulfillment: string }> = [
    { status: 'paid', paid: true, fulfillment: 'unfulfilled' },
    { status: 'fulfilled', paid: true, fulfillment: 'fulfilled' },
    { status: 'shipped', paid: true, fulfillment: 'fulfilled' },
    { status: 'delivered', paid: true, fulfillment: 'fulfilled' },
    { status: 'paid', paid: true, fulfillment: 'unfulfilled' },
    { status: 'delivered', paid: true, fulfillment: 'fulfilled' },
    { status: 'shipped', paid: true, fulfillment: 'fulfilled' },
    { status: 'fulfilled', paid: true, fulfillment: 'fulfilled' },
    { status: 'pending', paid: false, fulfillment: 'unfulfilled' },
    { status: 'pending', paid: false, fulfillment: 'unfulfilled' },
    { status: 'cancelled', paid: false, fulfillment: 'unfulfilled' },
  ];

  const ORDER_COUNT = ORDER_STATUSES.length; // 11
  let orderItemTotal = 0;
  let ledgerTotal = 0;
  let paidOrders = 0;

  // aggregaten voor customers
  const custSpent = new Map<string, number>();
  const custOrders = new Map<string, number>();

  for (let i = 0; i < ORDER_COUNT; i++) {
    const def2 = ORDER_STATUSES[i]!;
    const orderNumber = `${def.orderPrefix}-${1001 + i}`;
    const orderDate = daysAgo(i * 2 + 1); // i=0 → 1 dag geleden, oplopend
    const seedBase = shopIndexBase * 1000 + i * 7;

    // 1-3 items uit gepubliceerde producten
    const itemCount = randInt(1, 3, seedBase + 1);
    const chosen: PublishableProduct[] = [];
    for (let k = 0; k < itemCount; k++) {
      const idx = randInt(0, publishedVariants.length - 1, seedBase + 11 + k);
      const pv = publishedVariants[idx];
      if (pv) chosen.push(pv);
    }
    if (chosen.length === 0 && publishedVariants[0]) chosen.push(publishedVariants[0]);

    // bedragen berekenen — prijzen zijn INCL btw (vatConfig.priceIncludesVat)
    let grossSum = 0; // incl btw
    let netSum = 0;
    let vatSum = 0;
    let cogsSum = 0;
    const itemRows: Array<{
      variantId: string;
      sku: string;
      title: string;
      qty: number;
      unitPriceGross: number;
      lineGross: number;
      lineNet: number;
      lineVat: number;
      cost: number;
    }> = [];

    for (let k = 0; k < chosen.length; k++) {
      const pv = chosen[k]!;
      const qty = randInt(1, 3, seedBase + 21 + k);
      const unitGross = Number(pv.price);
      const lineGross = unitGross * qty;
      const lineNet = lineGross / (1 + VAT_FACTOR);
      const lineVat = lineGross - lineNet;
      const unitCost = pv.costPrice ? Number(pv.costPrice) : unitGross * 0.55;
      const cost = unitCost * qty;

      grossSum += lineGross;
      netSum += lineNet;
      vatSum += lineVat;
      cogsSum += cost;

      itemRows.push({
        variantId: pv.variantId,
        sku: pv.sku,
        title: pv.title,
        qty,
        unitPriceGross: unitGross,
        lineGross,
        lineNet,
        lineVat,
        cost,
      });
    }

    // round per-order
    const subtotalNet = Math.round(netSum * 100) / 100;
    const taxTotal = Math.round(vatSum * 100) / 100;
    const grandTotal = Math.round(grossSum * 100) / 100;

    const customerIdx = i % customerIds.length;
    const customerId = customerIds[customerIdx]!;
    const cust = def.customers[customerIdx]!;

    const address = {
      name: `${cust.firstName} ${cust.lastName}`,
      company: cust.company,
      line1: cust.line1,
      postcode: cust.postcode,
      city: cust.city,
      country: 'NL',
      phone: cust.phone,
    };

    const [order] = await db
      .insert(orders)
      .values({
        shopId,
        orderNumber,
        customerId,
        email: cust.email,
        channel: 'web',
        status: def2.status,
        financialStatus: def2.paid ? 'paid' : 'pending',
        fulfillmentStatus: def2.fulfillment,
        currency: 'EUR',
        subtotal: money(subtotalNet),
        discountTotal: '0',
        shippingTotal: '0',
        taxTotal: money(taxTotal),
        grandTotal: money(grandTotal),
        billingAddress: address,
        shippingAddress: address,
        placedAt: orderDate,
        createdAt: orderDate,
        updatedAt: orderDate,
      })
      .returning({ id: orders.id });
    const orderId = order!.id;

    // order_items
    for (const r of itemRows) {
      const lineNetRounded = Math.round(r.lineNet * 100) / 100;
      const lineVatRounded = Math.round(r.lineVat * 100) / 100;
      await db.insert(orderItems).values({
        orderId,
        variantId: r.variantId,
        sku: r.sku,
        title: r.title,
        quantity: r.qty,
        unitPrice: money(r.unitPriceGross),
        taxRate: String(VAT_RATE),
        taxAmount: money(lineVatRounded),
        costPrice: money(Math.round((r.cost / r.qty) * 100) / 100),
        lineTotal: money(Math.round(r.lineGross * 100) / 100),
      });
      orderItemTotal++;
      void lineNetRounded;
    }

    if (def2.paid) {
      paidOrders++;
      // payment
      await db.insert(orderPayments).values({
        orderId,
        provider: 'mock',
        amount: money(grandTotal),
        status: 'paid',
        reference: `PAY-${orderNumber}`,
        paidAt: orderDate,
        createdAt: orderDate,
      });

      // ledger: revenue (credit netto), vat_payable (credit btw), cogs (debit inkoop)
      const entryDate = isoDate(orderDate);
      const cogsRounded = Math.round(cogsSum * 100) / 100;
      await db.insert(ledgerEntries).values([
        {
          shopId,
          orderId,
          entryDate,
          account: 'revenue',
          debit: '0',
          credit: money(subtotalNet),
          currency: 'EUR',
          vatRate: String(VAT_RATE),
          vatCountry: 'NL',
          channel: 'web',
          description: `Omzet order ${orderNumber}`,
          createdAt: orderDate,
        },
        {
          shopId,
          orderId,
          entryDate,
          account: 'vat_payable',
          debit: '0',
          credit: money(taxTotal),
          currency: 'EUR',
          vatRate: String(VAT_RATE),
          vatCountry: 'NL',
          channel: 'web',
          description: `BTW order ${orderNumber}`,
          createdAt: orderDate,
        },
        {
          shopId,
          orderId,
          entryDate,
          account: 'cogs',
          debit: money(cogsRounded),
          credit: '0',
          currency: 'EUR',
          vatRate: String(VAT_RATE),
          vatCountry: 'NL',
          channel: 'web',
          description: `Inkoopkosten order ${orderNumber}`,
          createdAt: orderDate,
        },
      ]);
      ledgerTotal += 3;

      // customer-aggregaten (alleen betaalde tellen mee)
      custSpent.set(customerId, (custSpent.get(customerId) ?? 0) + grandTotal);
      custOrders.set(customerId, (custOrders.get(customerId) ?? 0) + 1);
    }
  }

  // customer-aggregaten bijwerken
  for (const customerId of customerIds) {
    const spent = custSpent.get(customerId) ?? 0;
    const count = custOrders.get(customerId) ?? 0;
    if (count > 0) {
      await db
        .update(customers)
        .set({ ordersCount: count, totalSpent: money(Math.round(spent * 100) / 100) })
        .where(eq(customers.id, customerId));
    }
  }

  return {
    publishedProducts: toPublish.length,
    customers: def.customers.length,
    orders: ORDER_COUNT,
    paidOrders,
    orderItems: orderItemTotal,
    ledgerEntries: ledgerTotal,
    pages: 2,
    blogPosts: def.blog.length,
    menuItems: menuItems.length,
  };
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  logger.info('Seeding demo-shops…');

  if (await cremaExists()) {
    logger.info('demo-shops bestaan al (shop-slug crema) — skip.');
    return;
  }

  const mainLocationId = await getMainLocationId();
  const catalog = await loadCatalog();
  logger.info(
    { products: catalog.productIds.length, variants: catalog.firstVariant.size },
    'catalogus geladen',
  );

  const summaries: Record<string, Awaited<ReturnType<typeof seedShop>>> = {};
  for (let s = 0; s < SHOP_DEFS.length; s++) {
    const def = SHOP_DEFS[s]!;
    const res = await seedShop(def, s, mainLocationId, catalog);
    summaries[def.slug] = res;
    logger.info({ shop: def.slug, ...res }, `shop '${def.slug}' geseed`);
  }

  // Eind-verificatie: tel rijen rechtstreeks uit de DB.
  const allShops = await db.select({ id: shops.id, slug: shops.slug }).from(shops);
  logger.info({ totalShops: allShops.length }, 'verificatie — shops');

  for (const sh of allShops) {
    const [sp] = await db
      .select({ id: shopProducts.id })
      .from(shopProducts)
      .where(eq(shopProducts.shopId, sh.id));
    const pubProducts = await db
      .select({ id: shopProducts.id })
      .from(shopProducts)
      .where(eq(shopProducts.shopId, sh.id));
    const pages = await db.select({ id: cmsPages.id }).from(cmsPages).where(eq(cmsPages.shopId, sh.id));
    const menus = await db.select({ id: cmsMenus.id }).from(cmsMenus).where(eq(cmsMenus.shopId, sh.id));
    const blogs = await db.select({ id: blogPosts.id }).from(blogPosts).where(eq(blogPosts.shopId, sh.id));
    const custs = await db.select({ id: customers.id }).from(customers).where(eq(customers.shopId, sh.id));
    const ords = await db.select({ id: orders.id }).from(orders).where(eq(orders.shopId, sh.id));
    const ledgers = await db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.shopId, sh.id));
    void sp;
    logger.info(
      {
        shop: sh.slug,
        shopProducts: pubProducts.length,
        cmsPages: pages.length,
        cmsMenus: menus.length,
        blogPosts: blogs.length,
        customers: custs.length,
        orders: ords.length,
        ledgerEntries: ledgers.length,
      },
      `verificatie — ${sh.slug}`,
    );
  }

  logger.info('Demo-shops-seed OK.');
}

main()
  .catch((err) => {
    logger.error({ err }, 'Demo-shops-seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
