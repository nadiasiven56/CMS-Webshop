/**
 * Extended mock-data voor preview-pages (Atlas).
 *
 * Aanvulling op `mock-data.ts` (dat producten + voorraad + dashboard-KPIs levert).
 * Deze module voegt toe: orders, klanten, retouren, locaties, PO's, leveranciers,
 * kanalen, financieel, ledger, settings (users/tokens/webhooks).
 *
 * Pure-frontend: geen backend-calls, alle data is deterministisch via seed.
 */

import { MOCK_PRODUCTS, MOCK_STOCK_ROWS } from './mock-data';

/* ─── Helpers ────────────────────────────────────────────────────────── */

function seededRand(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return ((h >>> 0) % 100000) / 100000;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function uuid(seed: string, n: number): string {
  const r = seededRand(`${seed}-${n}`);
  const hex = (len: number) =>
    Array.from({ length: len }, () => Math.floor(r() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}

function daysAgo(d: number): string {
  return new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

function daysFromNow(d: number): string {
  return new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();
}

/* ─── Channels (referentie-set, ook gebruikt door orders) ───────────── */

export type ChannelSlug =
  | 'storefront-koffie'
  | 'storefront-pawfect'
  | 'bol'
  | 'amazon-nl'
  | 'gmc';

export interface MockChannel {
  slug: ChannelSlug;
  name: string;
  type: 'storefront' | 'marketplace' | 'feed';
  status: 'connected' | 'warning' | 'error' | 'paused';
  domain?: string;
  lastSync: string; // ISO
  productsEnabled: number;
  productsDisabled: number;
  ordersToday: number;
  health: string; // korte status-tekst
  logoLetter: string;
  accentColor: string;
}

export const MOCK_CHANNELS: MockChannel[] = [
  {
    slug: 'storefront-koffie',
    name: 'Crema & Co.',
    type: 'storefront',
    status: 'connected',
    domain: 'cremaenco.nl',
    lastSync: hoursAgo(0.05),
    productsEnabled: 47,
    productsDisabled: 3,
    ordersToday: 3,
    health: 'Eigen webshop — Storefront-API actief',
    logoLetter: 'C',
    accentColor: '#ff9f43',
  },
  {
    slug: 'storefront-pawfect',
    name: 'Pawfect Hondenshop',
    type: 'storefront',
    status: 'connected',
    domain: 'pawfect.nl',
    lastSync: hoursAgo(0.2),
    productsEnabled: 28,
    productsDisabled: 0,
    ordersToday: 1,
    health: 'Eigen webshop — Storefront-API actief',
    logoLetter: 'P',
    accentColor: '#60a5fa',
  },
  {
    slug: 'gmc',
    name: 'Google Merchant Center',
    type: 'feed',
    status: 'connected',
    lastSync: hoursAgo(2),
    productsEnabled: 47,
    productsDisabled: 3,
    ordersToday: 0,
    health: 'XML-feed gegenereerd, laatst opgehaald 2u geleden',
    logoLetter: 'G',
    accentColor: '#4285f4',
  },
  {
    slug: 'bol',
    name: 'Bol.com',
    type: 'marketplace',
    status: 'warning',
    lastSync: hoursAgo(4),
    productsEnabled: 35,
    productsDisabled: 15,
    ordersToday: 2,
    health: 'Rate-limit getroffen om 14:32 — 18 calls overgeslagen',
    logoLetter: 'B',
    accentColor: '#0000a4',
  },
  {
    slug: 'amazon-nl',
    name: 'Amazon NL',
    type: 'marketplace',
    status: 'paused',
    lastSync: daysAgo(2),
    productsEnabled: 0,
    productsDisabled: 50,
    ordersToday: 0,
    health: 'Gepauzeerd door operator — wacht op SP-API credentials',
    logoLetter: 'A',
    accentColor: '#ff9900',
  },
];

export function getChannel(slug: ChannelSlug): MockChannel | undefined {
  return MOCK_CHANNELS.find((c) => c.slug === slug);
}

/* ─── Customers ──────────────────────────────────────────────────────── */

const FIRST_NAMES = [
  'Jan', 'Pieter', 'Sophie', 'Emma', 'Lars', 'Sanne', 'Tim', 'Lotte', 'Daan', 'Eva',
  'Niels', 'Anouk', 'Bram', 'Iris', 'Tom', 'Lisa', 'Mark', 'Julia', 'Bas', 'Fleur',
  'Lucas', 'Nina', 'Ruben', 'Maud',
] as const;

const LAST_NAMES = [
  'de Vries', 'Jansen', 'van den Berg', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer',
  'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen', 'Dekker',
] as const;

const COMPANIES = [
  'Café Bonté', 'Espresso Workshop', 'Hondencentrum Noord', 'Veterinaire Praktijk Mulder',
  'Pet Boutique Utrecht', 'Koffielab Amsterdam', 'Brouwerij De Schelp', 'Restaurant Anker',
  'Fysio De Linde', 'Trainingscentrum K9',
] as const;

const CITIES_NL = [
  { city: 'Amsterdam', zip: '1012 AB' },
  { city: 'Utrecht', zip: '3511 LM' },
  { city: 'Rotterdam', zip: '3011 AD' },
  { city: 'Den Haag', zip: '2511 CV' },
  { city: 'Eindhoven', zip: '5611 AZ' },
  { city: 'Groningen', zip: '9711 LN' },
  { city: 'Haarlem', zip: '2011 EM' },
  { city: 'Zwolle', zip: '8011 PJ' },
];

const CITIES_OTHER = [
  { country: 'DE', city: 'Berlin', zip: '10115' },
  { country: 'DE', city: 'München', zip: '80331' },
  { country: 'BE', city: 'Antwerpen', zip: '2000' },
  { country: 'BE', city: 'Gent', zip: '9000' },
  { country: 'FR', city: 'Paris', zip: '75001' },
];

export interface MockCustomer {
  id: string;
  type: 'B2C' | 'B2B';
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  company?: string;
  vatNumber?: string;
  country: string;
  city: string;
  zip: string;
  street: string;
  ordersCount: number;
  lifetimeValue: number;
  lastOrderAt: string;
  createdAt: string;
  defaultPaymentTerms?: string;
  marketingOptIn: boolean;
  notes?: string;
}

function buildCustomer(seed: number): MockCustomer {
  const rng = seededRand(`cust-${seed}`);
  const isB2B = rng() < 0.32;
  const first = pick(rng, FIRST_NAMES);
  const last = pick(rng, LAST_NAMES);
  const fullName = `${first} ${last}`;
  const isForeign = rng() < 0.18;
  const addr = isForeign ? pick(rng, CITIES_OTHER) : { country: 'NL', ...pick(rng, CITIES_NL) };
  const company = isB2B ? pick(rng, COMPANIES) : undefined;
  const orderCount = isB2B
    ? 4 + Math.floor(rng() * 18)
    : 1 + Math.floor(rng() * 6);
  const ltv = Math.round(orderCount * (isB2B ? 220 + rng() * 850 : 95 + rng() * 380) * 100) / 100;
  const emailSlug = (company ?? `${first}.${last}`)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
  const tld = addr.country === 'NL' ? '.nl' : addr.country === 'DE' ? '.de' : addr.country === 'BE' ? '.be' : addr.country === 'FR' ? '.fr' : '.com';
  const email = `${emailSlug}${isB2B ? '@' : '.' + Math.floor(rng() * 99) + '@'}${isForeign ? 'mail' : 'gmail'}${tld}`.replace('@.', '@');
  const phonePrefix = addr.country === 'NL' ? '+31 6 ' : addr.country === 'DE' ? '+49 ' : addr.country === 'BE' ? '+32 ' : addr.country === 'FR' ? '+33 ' : '+31 ';
  const phone = `${phonePrefix}${Math.floor(10000000 + rng() * 89999999)}`.slice(0, 18);

  return {
    id: uuid('cust', seed),
    type: isB2B ? 'B2B' : 'B2C',
    firstName: first,
    lastName: last,
    fullName,
    email,
    phone,
    company,
    vatNumber: isB2B ? `${addr.country}${Math.floor(100000000 + rng() * 899999999)}B01` : undefined,
    country: addr.country,
    city: addr.city,
    zip: addr.zip,
    street: `${pick(rng, ['Hoofdstraat', 'Kerkplein', 'Damstraat', 'Marktweg', 'Wilhelminalaan', 'Stationsstraat'])} ${1 + Math.floor(rng() * 240)}`,
    ordersCount: orderCount,
    lifetimeValue: ltv,
    lastOrderAt: daysAgo(Math.floor(rng() * 90)),
    createdAt: daysAgo(60 + Math.floor(rng() * 540)),
    defaultPaymentTerms: isB2B ? pick(rng, ['Netto 14 dagen', 'Netto 30 dagen', 'Per omgaande']) : undefined,
    marketingOptIn: rng() > 0.4,
    notes: isB2B && rng() > 0.7 ? 'Levert wekelijks aan eindklant — vaste afspraak.' : undefined,
  };
}

export const MOCK_CUSTOMERS: MockCustomer[] = Array.from({ length: 28 }, (_, i) => buildCustomer(i + 1));

export function getCustomer(id: string): MockCustomer | undefined {
  return MOCK_CUSTOMERS.find((c) => c.id === id);
}

/* ─── Orders ─────────────────────────────────────────────────────────── */

export type OrderStatus = 'open' | 'allocated' | 'picked' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentStatus = 'paid' | 'pending' | 'refunded' | 'partially_refunded';
export type VatScheme = 'NL-21' | 'NL-9' | 'OSS-DE' | 'OSS-FR' | 'OSS-BE' | 'EU-B2B-reverse' | 'IOSS';

export interface MockOrderLine {
  id: string;
  productId: string;
  variantSku: string;
  title: string;
  qty: number;
  unitPrice: number;
  unitPriceExclVat: number;
  vatRate: number;
  lineTotal: number;
  imageUrl: string | null;
}

export interface MockOrder {
  id: string;
  number: string; // ORD-24018
  channel: ChannelSlug;
  customerId: string;
  customerName: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  currency: 'EUR';
  subtotalExclVat: number;
  vatAmount: number;
  shippingAmount: number;
  discountAmount: number;
  total: number;
  vatScheme: VatScheme;
  vatBreakdown: Array<{ rate: number; base: number; amount: number; label: string }>;
  shippingMethod: string;
  trackingNumber?: string;
  itemsCount: number;
  lines: MockOrderLine[];
  createdAt: string;
  paidAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  shippingAddress: { name: string; street: string; zip: string; city: string; country: string };
  billingAddress: { name: string; street: string; zip: string; city: string; country: string };
  notes?: string;
  invoiceNumber?: string;
}

const CHANNEL_SLUGS: ChannelSlug[] = ['storefront-koffie', 'storefront-pawfect', 'bol', 'amazon-nl'];
const SHIPPING_METHODS = ['PostNL Standard', 'PostNL Avond', 'DHL ServicePoint', 'DPD Pickup', 'Sendcloud Same Day'] as const;

function buildOrder(seed: number): MockOrder {
  const rng = seededRand(`order-${seed}`);
  const customer = MOCK_CUSTOMERS[Math.floor(rng() * MOCK_CUSTOMERS.length)]!;
  const channel = pick(rng, CHANNEL_SLUGS);
  const lineCount = 1 + Math.floor(rng() * 4);
  const lines: MockOrderLine[] = [];
  let subtotal = 0;
  let vatTotal = 0;

  for (let i = 0; i < lineCount; i++) {
    const product = MOCK_PRODUCTS[Math.floor(rng() * MOCK_PRODUCTS.length)]!;
    const variant = product.variants[0]!;
    const qty = 1 + Math.floor(rng() * 3);
    const unitPrice = Math.round((variant.price ?? 100) * 100) / 100;
    const vatRate = product.productType === 'Bonen' ? 9 : 21;
    const unitPriceExclVat = Math.round((unitPrice / (1 + vatRate / 100)) * 100) / 100;
    const lineTotal = Math.round(qty * unitPrice * 100) / 100;
    const lineExcl = Math.round(qty * unitPriceExclVat * 100) / 100;
    const lineVat = Math.round((lineTotal - lineExcl) * 100) / 100;
    subtotal += lineExcl;
    vatTotal += lineVat;
    lines.push({
      id: uuid(`line-${seed}`, i),
      productId: product.id,
      variantSku: variant.sku ?? 'SKU-?',
      title: product.title + (variant.title !== 'Default' ? ` — ${variant.title}` : ''),
      qty,
      unitPrice,
      unitPriceExclVat,
      vatRate,
      lineTotal,
      imageUrl: product.primaryImageUrl,
    });
  }

  const shipping = Math.round((rng() > 0.3 ? 6.95 : 0) * 100) / 100;
  const discount = rng() > 0.85 ? Math.round((subtotal * 0.1) * 100) / 100 : 0;
  const total = Math.round((subtotal + vatTotal + shipping - discount) * 100) / 100;

  // Status distribution
  const ageDays = Math.floor(rng() * 21);
  let status: OrderStatus;
  if (ageDays < 1) status = pick(rng, ['open', 'open', 'allocated']);
  else if (ageDays < 3) status = pick(rng, ['allocated', 'picked', 'picked']);
  else if (ageDays < 7) status = pick(rng, ['shipped', 'shipped', 'delivered']);
  else status = pick(rng, ['delivered', 'delivered', 'delivered', 'cancelled']);

  const paymentStatus: PaymentStatus = status === 'cancelled'
    ? 'refunded'
    : status === 'open' && rng() > 0.7
    ? 'pending'
    : 'paid';

  // VAT scheme
  let vatScheme: VatScheme = 'NL-21';
  if (customer.country !== 'NL') {
    if (customer.type === 'B2B') vatScheme = 'EU-B2B-reverse';
    else if (customer.country === 'DE') vatScheme = 'OSS-DE';
    else if (customer.country === 'FR') vatScheme = 'OSS-FR';
    else if (customer.country === 'BE') vatScheme = 'OSS-BE';
  } else if (lines.some((l) => l.vatRate === 9)) {
    vatScheme = 'NL-9';
  }

  const createdAt = daysAgo(ageDays);
  const paidAt = paymentStatus === 'paid' ? hoursAgo(ageDays * 24 - 1) : undefined;
  const shippedAt = ['shipped', 'delivered'].includes(status) ? daysAgo(Math.max(0, ageDays - 1)) : undefined;
  const deliveredAt = status === 'delivered' ? daysAgo(Math.max(0, ageDays - 2)) : undefined;
  const trackingNumber = shippedAt ? `3SBOL${String(seed).padStart(10, '0')}NL` : undefined;

  // Build VAT breakdown
  const vatBreakdown: MockOrder['vatBreakdown'] = [];
  const rate21Lines = lines.filter((l) => l.vatRate === 21);
  const rate9Lines = lines.filter((l) => l.vatRate === 9);
  if (rate21Lines.length > 0) {
    const base = rate21Lines.reduce((s, l) => s + Math.round((l.lineTotal / 1.21) * 100) / 100, 0);
    vatBreakdown.push({ rate: 21, base: Math.round(base * 100) / 100, amount: Math.round(base * 0.21 * 100) / 100, label: '21% NL' });
  }
  if (rate9Lines.length > 0) {
    const base = rate9Lines.reduce((s, l) => s + Math.round((l.lineTotal / 1.09) * 100) / 100, 0);
    vatBreakdown.push({ rate: 9, base: Math.round(base * 100) / 100, amount: Math.round(base * 0.09 * 100) / 100, label: '9% NL (voeding)' });
  }

  const address = {
    name: customer.fullName,
    street: customer.street,
    zip: customer.zip,
    city: customer.city,
    country: customer.country,
  };

  return {
    id: uuid('order', seed),
    number: `ORD-${24000 + seed}`,
    channel,
    customerId: customer.id,
    customerName: customer.company ?? customer.fullName,
    status,
    paymentStatus,
    paymentMethod: pick(rng, ['iDEAL', 'Creditcard', 'PayPal', 'Bancontact', 'Klarna', 'Op rekening']),
    currency: 'EUR',
    subtotalExclVat: Math.round(subtotal * 100) / 100,
    vatAmount: Math.round(vatTotal * 100) / 100,
    shippingAmount: shipping,
    discountAmount: discount,
    total,
    vatScheme,
    vatBreakdown,
    shippingMethod: pick(rng, SHIPPING_METHODS),
    trackingNumber,
    itemsCount: lines.reduce((s, l) => s + l.qty, 0),
    lines,
    createdAt,
    paidAt,
    shippedAt,
    deliveredAt,
    shippingAddress: address,
    billingAddress: address,
    notes: rng() > 0.85 ? 'Bel klant voor afleverafspraak.' : undefined,
    invoiceNumber: paymentStatus === 'paid' ? `2026-${String(1000 + seed).padStart(4, '0')}` : undefined,
  };
}

export const MOCK_ORDERS: MockOrder[] = Array.from({ length: 35 }, (_, i) => buildOrder(i + 1));

export function getOrder(id: string): MockOrder | undefined {
  return MOCK_ORDERS.find((o) => o.id === id || o.number === id);
}

export function getOrderEvents(order: MockOrder): Array<{ at: string; label: string; description: string; kind: 'created' | 'paid' | 'allocated' | 'picked' | 'shipped' | 'delivered' | 'cancelled' }> {
  const events: ReturnType<typeof getOrderEvents> = [];
  events.push({ at: order.createdAt, kind: 'created', label: 'Order geplaatst', description: `Via ${order.channel}` });
  if (order.paidAt) events.push({ at: order.paidAt, kind: 'paid', label: 'Betaling ontvangen', description: order.paymentMethod });
  if (['allocated', 'picked', 'shipped', 'delivered'].includes(order.status)) {
    events.push({ at: order.paidAt ?? order.createdAt, kind: 'allocated', label: 'Voorraad gereserveerd', description: 'Allocated in WH-NL' });
  }
  if (['picked', 'shipped', 'delivered'].includes(order.status)) {
    events.push({ at: order.paidAt ?? order.createdAt, kind: 'picked', label: 'Picked & gepackt', description: 'Door admin@webshop-crm.local' });
  }
  if (order.shippedAt) {
    events.push({ at: order.shippedAt, kind: 'shipped', label: 'Verzonden', description: `${order.shippingMethod} — ${order.trackingNumber}` });
  }
  if (order.deliveredAt) {
    events.push({ at: order.deliveredAt, kind: 'delivered', label: 'Bezorgd', description: 'Bevestigd door PostNL-scan' });
  }
  if (order.status === 'cancelled') {
    events.push({ at: order.createdAt, kind: 'cancelled', label: 'Geannuleerd', description: 'Door klant — refund verwerkt' });
  }
  return events.sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

/* ─── Returns / RMA ──────────────────────────────────────────────────── */

export type ReturnReason = 'niet-passend' | 'defect' | 'verkeerd-product' | 'overig';
export type ReturnStatus = 'requested' | 'approved' | 'received' | 'refunded' | 'rejected';

export interface MockReturn {
  id: string;
  rmaNumber: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  reason: ReturnReason;
  reasonDetail: string;
  status: ReturnStatus;
  itemsCount: number;
  refundAmount: number;
  createdAt: string;
  closedAt?: string;
}

const REASON_DETAILS: Record<ReturnReason, string[]> = {
  'niet-passend': ['Maat te klein', 'Maat te groot', 'Past niet bij interieur'],
  'defect': ['Aangekomen met deuk', 'Werkt niet meer na 1 week', 'Lekkende boiler'],
  'verkeerd-product': ['Andere kleur dan besteld', 'Verkeerde variant geleverd'],
  'overig': ['Bedacht me', 'Ander cadeau gekocht'],
};

function buildReturn(seed: number): MockReturn {
  const rng = seededRand(`rma-${seed}`);
  const order = MOCK_ORDERS[seed % MOCK_ORDERS.length]!;
  const reason = pick(rng, ['niet-passend', 'defect', 'verkeerd-product', 'overig'] as const);
  const reasonDetail = pick(rng, REASON_DETAILS[reason]);
  const status = pick(rng, ['requested', 'requested', 'approved', 'approved', 'received', 'refunded', 'refunded', 'rejected'] as const);
  const items = 1 + Math.floor(rng() * 2);
  const refund = status === 'rejected' ? 0 : Math.round(order.total * (items / order.itemsCount) * 100) / 100;
  const ageDays = Math.floor(rng() * 30);
  return {
    id: uuid('rma', seed),
    rmaNumber: `RMA-${String(2400 + seed).padStart(4, '0')}`,
    orderId: order.id,
    orderNumber: order.number,
    customerName: order.customerName,
    reason,
    reasonDetail,
    status,
    itemsCount: items,
    refundAmount: refund,
    createdAt: daysAgo(ageDays),
    closedAt: ['refunded', 'rejected'].includes(status) ? daysAgo(Math.max(0, ageDays - 4)) : undefined,
  };
}

export const MOCK_RETURNS: MockReturn[] = Array.from({ length: 12 }, (_, i) => buildReturn(i + 1));

/* ─── Locations ──────────────────────────────────────────────────────── */

export interface MockLocationFull {
  id: string;
  code: string;
  name: string;
  type: 'warehouse' | 'dropship' | 'virtual' | 'store';
  active: boolean;
  priority: number;
  street: string;
  zip: string;
  city: string;
  country: string;
  totalSkus: number;
  totalQty: number;
  ownerNote?: string;
}

export const MOCK_LOCATIONS_FULL: MockLocationFull[] = [
  {
    id: 'loc-warehouse-ams',
    code: 'WH-AMS',
    name: 'Hoofdmagazijn Amsterdam',
    type: 'warehouse',
    active: true,
    priority: 1,
    street: 'Industrieweg 42',
    zip: '1043 AB',
    city: 'Amsterdam',
    country: 'NL',
    totalSkus: 124,
    totalQty: 1842,
    ownerNote: 'Default fulfillment-locatie. WMS-koppeling actief.',
  },
  {
    id: 'loc-dropship-italia',
    code: 'DS-IT',
    name: 'Italia Caffè (dropship)',
    type: 'dropship',
    active: true,
    priority: 2,
    street: 'Via Roma 12',
    zip: '40100',
    city: 'Bologna',
    country: 'IT',
    totalSkus: 36,
    totalQty: 412,
    ownerNote: 'Leverancier dropshipt direct — voorraad-feed dagelijks 08:00.',
  },
  {
    id: 'loc-virtual-bol-fbb',
    code: 'BOL-FBB',
    name: 'Bol FBB (virtueel)',
    type: 'virtual',
    active: true,
    priority: 3,
    street: 'Kruisweg 100',
    zip: '2132 CC',
    city: 'Hoofddorp',
    country: 'NL',
    totalSkus: 28,
    totalQty: 218,
    ownerNote: 'Virtual location — fulfillment door Bol.com.',
  },
  {
    id: 'loc-showroom-utr',
    code: 'SHW-UTR',
    name: 'Showroom Utrecht',
    type: 'store',
    active: false,
    priority: 9,
    street: 'Steenweg 85',
    zip: '3511 JV',
    city: 'Utrecht',
    country: 'NL',
    totalSkus: 12,
    totalQty: 24,
    ownerNote: 'Tijdelijk gesloten ivm verbouwing — geen orders alloceren.',
  },
];

/* ─── Suppliers ──────────────────────────────────────────────────────── */

export interface MockSupplier {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  leadTimeDays: number;
  paymentTerms: string;
  currency: string;
  active: boolean;
  openPoCount: number;
  ytdSpent: number;
  category: string;
  notes?: string;
}

export const MOCK_SUPPLIERS: MockSupplier[] = [
  {
    id: 'sup-italia-caffe',
    name: 'Italia Caffè S.r.l.',
    contactName: 'Marco Rossi',
    email: 'orders@italiacaffe.it',
    phone: '+39 051 1234567',
    country: 'IT',
    city: 'Bologna',
    leadTimeDays: 7,
    paymentTerms: 'Netto 30 dagen',
    currency: 'EUR',
    active: true,
    openPoCount: 3,
    ytdSpent: 48420.5,
    category: 'Koffiebonen',
    notes: 'Premium-leverancier voor La Pavoni-reeks.',
  },
  {
    id: 'sup-rocket-espresso',
    name: 'Rocket Espresso B.V.',
    contactName: 'Sander van Dijk',
    email: 'b2b@rocket-espresso.nl',
    phone: '+31 20 4567890',
    country: 'NL',
    city: 'Amsterdam',
    leadTimeDays: 3,
    paymentTerms: 'Netto 14 dagen',
    currency: 'EUR',
    active: true,
    openPoCount: 1,
    ytdSpent: 32800,
    category: 'Espressomachines',
  },
  {
    id: 'sup-pawfect-supply',
    name: 'PawSupply Distributie',
    contactName: 'Eva Kuijpers',
    email: 'sales@pawsupply.nl',
    phone: '+31 30 1239876',
    country: 'NL',
    city: 'Utrecht',
    leadTimeDays: 2,
    paymentTerms: 'Per omgaande',
    currency: 'EUR',
    active: true,
    openPoCount: 2,
    ytdSpent: 18650,
    category: 'Hondenvoer',
  },
  {
    id: 'sup-eureka-grinders',
    name: 'Eureka Macinazione',
    contactName: 'Luca Bianchi',
    email: 'export@eureka.it',
    phone: '+39 0571 84001',
    country: 'IT',
    city: 'Florence',
    leadTimeDays: 14,
    paymentTerms: 'Netto 45 dagen',
    currency: 'EUR',
    active: true,
    openPoCount: 1,
    ytdSpent: 12340,
    category: 'Koffiemolens',
  },
  {
    id: 'sup-mahlkonig-de',
    name: 'Mahlkönig GmbH',
    contactName: 'Hans Müller',
    email: 'b2b@mahlkonig.de',
    phone: '+49 4101 78600',
    country: 'DE',
    city: 'Hamburg',
    leadTimeDays: 10,
    paymentTerms: 'Netto 30 dagen',
    currency: 'EUR',
    active: true,
    openPoCount: 0,
    ytdSpent: 9420,
    category: 'Koffiemolens',
  },
  {
    id: 'sup-tampers-spain',
    name: 'Tamper Workshop Madrid',
    contactName: 'Carlos Vidal',
    email: 'hola@tamperworkshop.es',
    phone: '+34 91 1234567',
    country: 'ES',
    city: 'Madrid',
    leadTimeDays: 5,
    paymentTerms: 'Per omgaande',
    currency: 'EUR',
    active: true,
    openPoCount: 0,
    ytdSpent: 3200,
    category: 'Accessoires',
  },
  {
    id: 'sup-belux-coffee',
    name: 'BeLux Coffee Trading',
    contactName: 'Pierre Lambert',
    email: 'po@beluxcoffee.be',
    phone: '+32 2 7654321',
    country: 'BE',
    city: 'Brussel',
    leadTimeDays: 4,
    paymentTerms: 'Netto 14 dagen',
    currency: 'EUR',
    active: false,
    openPoCount: 0,
    ytdSpent: 1840,
    category: 'Koffiebonen',
    notes: 'Tijdelijk inactief — wacht op nieuw contract.',
  },
  {
    id: 'sup-acme-packaging',
    name: 'ACME Verpakkingen',
    contactName: 'Jeroen de Wit',
    email: 'orders@acme-pack.nl',
    phone: '+31 88 1112233',
    country: 'NL',
    city: 'Tilburg',
    leadTimeDays: 1,
    paymentTerms: 'Netto 30 dagen',
    currency: 'EUR',
    active: true,
    openPoCount: 1,
    ytdSpent: 4280,
    category: 'Verpakking',
  },
];

/* ─── Purchase Orders ────────────────────────────────────────────────── */

export type PoStatus = 'draft' | 'sent' | 'confirmed' | 'partial' | 'received' | 'closed' | 'cancelled';

export interface MockPurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  status: PoStatus;
  itemsCount: number;
  orderedQty: number;
  receivedQty: number;
  totalExclVat: number;
  vatAmount: number;
  totalInclVat: number;
  currency: string;
  createdAt: string;
  expectedAt: string;
  receivedAt?: string;
  notes?: string;
}

function buildPo(seed: number): MockPurchaseOrder {
  const rng = seededRand(`po-${seed}`);
  const supplier = MOCK_SUPPLIERS[Math.floor(rng() * MOCK_SUPPLIERS.length)]!;
  const status = pick(rng, ['draft', 'sent', 'sent', 'confirmed', 'confirmed', 'partial', 'received', 'received', 'closed', 'cancelled'] as const);
  const items = 2 + Math.floor(rng() * 6);
  const orderedQty = items * (3 + Math.floor(rng() * 12));
  let receivedQty = 0;
  if (status === 'partial') receivedQty = Math.floor(orderedQty * (0.3 + rng() * 0.4));
  else if (status === 'received' || status === 'closed') receivedQty = orderedQty;
  const totalExcl = Math.round((orderedQty * (15 + rng() * 180)) * 100) / 100;
  const vatAmount = Math.round(totalExcl * 0.21 * 100) / 100;
  const ageDays = Math.floor(rng() * 25);
  const expectedDelta = supplier.leadTimeDays - ageDays;
  return {
    id: uuid('po', seed),
    number: `PO-${String(2400 + seed).padStart(4, '0')}`,
    supplierId: supplier.id,
    supplierName: supplier.name,
    status,
    itemsCount: items,
    orderedQty,
    receivedQty,
    totalExclVat: totalExcl,
    vatAmount,
    totalInclVat: Math.round((totalExcl + vatAmount) * 100) / 100,
    currency: supplier.currency,
    createdAt: daysAgo(ageDays),
    expectedAt: expectedDelta < 0 ? daysFromNow(0) : daysFromNow(expectedDelta),
    receivedAt: status === 'received' || status === 'closed' ? daysAgo(Math.max(0, ageDays - supplier.leadTimeDays)) : undefined,
    notes: rng() > 0.8 ? 'Bel leverancier voor bevestiging' : undefined,
  };
}

export const MOCK_PURCHASE_ORDERS: MockPurchaseOrder[] = Array.from({ length: 14 }, (_, i) => buildPo(i + 1));

/* ─── Per-product channel matrix ─────────────────────────────────────── */

export interface ProductChannelMatrixRow {
  productId: string;
  sku: string;
  title: string;
  imageUrl: string | null;
  channels: Record<ChannelSlug, { enabled: boolean; status: 'live' | 'pending' | 'error' | 'disabled' }>;
}

export const MOCK_PRODUCT_CHANNEL_MATRIX: ProductChannelMatrixRow[] = MOCK_PRODUCTS.slice(0, 30).map((p, i) => {
  const rng = seededRand(`pcm-${p.id}`);
  const channels: ProductChannelMatrixRow['channels'] = {
    'storefront-koffie': { enabled: true, status: 'live' },
    'storefront-pawfect': { enabled: i % 4 === 0, status: i % 4 === 0 ? 'live' : 'disabled' },
    'gmc': { enabled: rng() > 0.15, status: rng() > 0.15 ? 'live' : 'disabled' },
    'bol': rng() > 0.3
      ? { enabled: true, status: rng() > 0.85 ? 'error' : 'live' }
      : { enabled: false, status: 'disabled' },
    'amazon-nl': { enabled: false, status: 'disabled' },
  };
  return {
    productId: p.id,
    sku: p.variants[0]?.sku ?? 'SKU-?',
    title: p.title,
    imageUrl: p.primaryImageUrl,
    channels,
  };
});

/* ─── Finance ─────────────────────────────────────────────────────────── */

export interface FinanceKpis {
  periodLabel: string;
  revenueExclVat: number;
  vatTotal: number;
  cogs: number;
  grossMargin: number;
  grossMarginPct: number;
  shippingRevenue: number;
  shippingCost: number;
  refundedAmount: number;
  ordersCount: number;
}

export const MOCK_FINANCE_KPIS: FinanceKpis = {
  periodLabel: 'Q2 2026 (lopend)',
  revenueExclVat: 84720.45,
  vatTotal: 17791.29,
  cogs: 48780.15,
  grossMargin: 35940.30,
  grossMarginPct: 0.4243,
  shippingRevenue: 2410.5,
  shippingCost: 1820.4,
  refundedAmount: 1245.8,
  ordersCount: 318,
};

export interface ChannelRevenue {
  channel: ChannelSlug;
  channelName: string;
  revenue: number;
  vat: number;
  cogs: number;
  marginPct: number;
  orderCount: number;
}

export const MOCK_CHANNEL_REVENUE: ChannelRevenue[] = [
  { channel: 'storefront-koffie', channelName: 'Crema & Co.', revenue: 38240.5, vat: 8030.5, cogs: 21280, marginPct: 0.443, orderCount: 124 },
  { channel: 'storefront-pawfect', channelName: 'Pawfect', revenue: 14820.3, vat: 1334, cogs: 9740, marginPct: 0.343, orderCount: 89 },
  { channel: 'bol', channelName: 'Bol.com', revenue: 22480.95, vat: 4720.99, cogs: 14820, marginPct: 0.341, orderCount: 78 },
  { channel: 'amazon-nl', channelName: 'Amazon NL', revenue: 0, vat: 0, cogs: 0, marginPct: 0, orderCount: 0 },
  { channel: 'gmc', channelName: 'Google Shopping (Crema)', revenue: 9178.7, vat: 1705.8, cogs: 2940.15, marginPct: 0.679, orderCount: 27 },
];

export interface VatBreakdownRow {
  scheme: VatScheme;
  label: string;
  base: number;
  rate: number;
  amount: number;
  declarationDeadline?: string;
}

export const MOCK_VAT_BREAKDOWN: VatBreakdownRow[] = [
  { scheme: 'NL-21', label: 'NL hoog tarief 21%', base: 64820, rate: 21, amount: 13612.2, declarationDeadline: '2026-07-31' },
  { scheme: 'NL-9', label: 'NL laag tarief 9% (voeding)', base: 8240, rate: 9, amount: 741.6, declarationDeadline: '2026-07-31' },
  { scheme: 'OSS-DE', label: 'OSS Duitsland 19%', base: 6420, rate: 19, amount: 1219.8, declarationDeadline: '2026-07-31' },
  { scheme: 'OSS-FR', label: 'OSS Frankrijk 20%', base: 3180, rate: 20, amount: 636, declarationDeadline: '2026-07-31' },
  { scheme: 'OSS-BE', label: 'OSS België 21%', base: 1820, rate: 21, amount: 382.2, declarationDeadline: '2026-07-31' },
  { scheme: 'EU-B2B-reverse', label: 'EU B2B verlegd (reverse charge)', base: 4280, rate: 0, amount: 0, declarationDeadline: '2026-07-31' },
  { scheme: 'IOSS', label: 'IOSS export buiten EU', base: 480, rate: 0, amount: 0, declarationDeadline: '2026-06-30' },
];

export interface UpcomingDeclaration {
  id: string;
  type: 'OSS' | 'BTW-NL' | 'ICP' | 'IOSS';
  period: string;
  deadline: string;
  status: 'open' | 'submitted' | 'overdue';
  expectedAmount: number;
}

export const MOCK_UPCOMING_DECLARATIONS: UpcomingDeclaration[] = [
  { id: 'dec-1', type: 'BTW-NL', period: 'Q1 2026', deadline: '2026-04-30', status: 'submitted', expectedAmount: 12180 },
  { id: 'dec-2', type: 'OSS', period: 'Q1 2026', deadline: '2026-04-30', status: 'submitted', expectedAmount: 2240 },
  { id: 'dec-3', type: 'ICP', period: 'Q1 2026', deadline: '2026-04-30', status: 'submitted', expectedAmount: 0 },
  { id: 'dec-4', type: 'IOSS', period: 'Apr 2026', deadline: '2026-05-31', status: 'open', expectedAmount: 0 },
  { id: 'dec-5', type: 'BTW-NL', period: 'Q2 2026', deadline: '2026-07-31', status: 'open', expectedAmount: 14353.8 },
  { id: 'dec-6', type: 'OSS', period: 'Q2 2026', deadline: '2026-07-31', status: 'open', expectedAmount: 2238 },
];

/* ─── Accounting ─────────────────────────────────────────────────────── */

export interface AccountingConnection {
  id: string;
  name: string;
  status: 'connected' | 'sandbox' | 'not-connected' | 'error';
  description: string;
  lastSync?: string;
  alwaysOn?: boolean;
}

export const MOCK_ACCOUNTING_CONNECTIONS: AccountingConnection[] = [
  { id: 'mb', name: 'Moneybird', status: 'sandbox', description: 'Sandbox-omgeving — facturen worden gepusht naar Moneybird-test.', lastSync: hoursAgo(0.5) },
  { id: 'eo', name: 'Exact Online', status: 'not-connected', description: 'Niet gekoppeld. Klik om OAuth te starten.' },
  { id: 'ubl', name: 'UBL bestanden', status: 'connected', description: 'UBL e-invoicing altijd beschikbaar — exports per kwartaal.', alwaysOn: true },
  { id: 'csv', name: 'CSV export', status: 'connected', description: 'CSV-export voor handmatige boekhouder-overdracht.', alwaysOn: true },
];

export interface AccountingExport {
  id: string;
  type: 'invoice' | 'ledger' | 'oss' | 'icp' | 'ubl-batch';
  period: string;
  status: 'success' | 'failed' | 'pending';
  externalRef?: string;
  recordCount: number;
  createdAt: string;
}

export const MOCK_ACCOUNTING_EXPORTS: AccountingExport[] = [
  { id: 'exp-1', type: 'invoice', period: 'Mei week 18', status: 'success', externalRef: 'mb-batch-2026-w18', recordCount: 38, createdAt: hoursAgo(2) },
  { id: 'exp-2', type: 'ubl-batch', period: 'Apr 2026', status: 'success', externalRef: 'ubl-2026-04.zip', recordCount: 142, createdAt: daysAgo(8) },
  { id: 'exp-3', type: 'oss', period: 'Q1 2026', status: 'success', externalRef: 'oss-q1-2026.csv', recordCount: 1, createdAt: daysAgo(9) },
  { id: 'exp-4', type: 'icp', period: 'Q1 2026', status: 'success', externalRef: 'icp-q1-2026.csv', recordCount: 4, createdAt: daysAgo(9) },
  { id: 'exp-5', type: 'invoice', period: 'Mei week 19', status: 'pending', recordCount: 0, createdAt: hoursAgo(0.5) },
  { id: 'exp-6', type: 'invoice', period: 'Apr week 17', status: 'failed', externalRef: 'mb-batch-2026-w17', recordCount: 4, createdAt: daysAgo(15) },
];

/* ─── Ledger / Grootboek ─────────────────────────────────────────────── */

export interface MockLedgerEntry {
  id: string;
  date: string;
  account: string;
  accountCode: string;
  debit: number;
  credit: number;
  refType: 'order' | 'po' | 'refund' | 'payout' | 'adjust' | 'shipping';
  refId: string;
  description: string;
  channel?: ChannelSlug;
}

const ACCOUNTS = [
  { code: '8000', name: 'Omzet (excl BTW)' },
  { code: '8005', name: 'Omzet 9% (voeding)' },
  { code: '8010', name: 'Omzet OSS-DE' },
  { code: '8011', name: 'Omzet OSS-FR' },
  { code: '7000', name: 'Inkoopwaarde verkoop' },
  { code: '4500', name: 'Verzendkosten' },
  { code: '1500', name: 'Te ontvangen — debiteuren' },
  { code: '1600', name: 'Te betalen — crediteuren' },
  { code: '1810', name: 'BTW af te dragen 21%' },
  { code: '1815', name: 'BTW af te dragen 9%' },
  { code: '4400', name: 'Voorraadcorrecties' },
] as const;

function buildLedger(seed: number): MockLedgerEntry {
  const rng = seededRand(`led-${seed}`);
  const account = pick(rng, ACCOUNTS);
  const isDebit = rng() > 0.5;
  const amount = Math.round(rng() * 480 * 100) / 100;
  const refTypes = ['order', 'po', 'shipping', 'order', 'order', 'refund', 'adjust'] as const;
  const refType = pick(rng, refTypes);
  const refId = refType === 'order'
    ? `ORD-${24000 + Math.floor(rng() * 35)}`
    : refType === 'po'
    ? `PO-${String(2400 + Math.floor(rng() * 14)).padStart(4, '0')}`
    : refType === 'refund'
    ? `RMA-${String(2400 + Math.floor(rng() * 12)).padStart(4, '0')}`
    : `ADJ-${String(seed).padStart(4, '0')}`;
  return {
    id: uuid('led', seed),
    date: daysAgo(Math.floor(rng() * 60)),
    account: account.name,
    accountCode: account.code,
    debit: isDebit ? amount : 0,
    credit: isDebit ? 0 : amount,
    refType,
    refId,
    description: `${refType.toUpperCase()} ${refId} — boeking op ${account.code}`,
    channel: refType === 'order' ? pick(rng, CHANNEL_SLUGS) : undefined,
  };
}

export const MOCK_LEDGER: MockLedgerEntry[] = Array.from({ length: 60 }, (_, i) => buildLedger(i + 1));

export const MOCK_LEDGER_ACCOUNTS = ACCOUNTS;

/* ─── Settings: Users ────────────────────────────────────────────────── */

export interface MockAdminUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'staff' | 'fulfillment' | 'finance' | 'readonly';
  active: boolean;
  lastLoginAt?: string;
  createdAt: string;
  twoFactor: boolean;
}

export const MOCK_ADMIN_USERS: MockAdminUser[] = [
  {
    id: 'usr-1',
    name: 'Atlas Operator',
    email: 'admin@webshop-crm.local',
    role: 'admin',
    active: true,
    lastLoginAt: hoursAgo(0.05),
    createdAt: daysAgo(180),
    twoFactor: true,
  },
  {
    id: 'usr-2',
    name: 'Eva Kuijpers',
    email: 'eva@webshop-crm.local',
    role: 'fulfillment',
    active: true,
    lastLoginAt: hoursAgo(3),
    createdAt: daysAgo(90),
    twoFactor: true,
  },
  {
    id: 'usr-3',
    name: 'Tom Bakker',
    email: 'tom@webshop-crm.local',
    role: 'finance',
    active: true,
    lastLoginAt: daysAgo(2),
    createdAt: daysAgo(60),
    twoFactor: false,
  },
  {
    id: 'usr-4',
    name: 'Sanne Visser (uitgenodigd)',
    email: 'sanne@webshop-crm.local',
    role: 'staff',
    active: false,
    createdAt: daysAgo(2),
    twoFactor: false,
  },
];

/* ─── Settings: API tokens ───────────────────────────────────────────── */

export interface MockApiToken {
  id: string;
  label: string;
  prefix: string;
  scope: 'storefront' | 'channel' | 'admin' | 'webhook';
  scopeDetail?: string;
  active: boolean;
  lastUsedAt?: string;
  createdAt: string;
  createdBy: string;
}

export const MOCK_API_TOKENS: MockApiToken[] = [
  {
    id: 'tok-1',
    label: 'Storefront — Crema & Co.',
    prefix: 'sk_sf_crema_',
    scope: 'storefront',
    scopeDetail: 'storefront-koffie',
    active: true,
    lastUsedAt: hoursAgo(0.05),
    createdAt: daysAgo(160),
    createdBy: 'admin@webshop-crm.local',
  },
  {
    id: 'tok-2',
    label: 'Storefront — Pawfect',
    prefix: 'sk_sf_pawfect_',
    scope: 'storefront',
    scopeDetail: 'storefront-pawfect',
    active: true,
    lastUsedAt: hoursAgo(0.2),
    createdAt: daysAgo(140),
    createdBy: 'admin@webshop-crm.local',
  },
  {
    id: 'tok-3',
    label: 'Channel — Bol.com poller',
    prefix: 'ch_bol_',
    scope: 'channel',
    scopeDetail: 'bol',
    active: true,
    lastUsedAt: hoursAgo(4),
    createdAt: daysAgo(120),
    createdBy: 'admin@webshop-crm.local',
  },
  {
    id: 'tok-4',
    label: 'Admin readonly — accountant',
    prefix: 'ad_ro_',
    scope: 'admin',
    scopeDetail: 'readonly',
    active: true,
    lastUsedAt: daysAgo(7),
    createdAt: daysAgo(45),
    createdBy: 'admin@webshop-crm.local',
  },
  {
    id: 'tok-5',
    label: 'Sendcloud webhook (deprecated)',
    prefix: 'wh_sc_old_',
    scope: 'webhook',
    scopeDetail: 'sendcloud',
    active: false,
    lastUsedAt: daysAgo(40),
    createdAt: daysAgo(220),
    createdBy: 'admin@webshop-crm.local',
  },
];

/* ─── Settings: Webhooks ─────────────────────────────────────────────── */

export interface MockWebhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  successRate: number; // 0-1
  deliveriesLast24h: number;
  lastDeliveryAt?: string;
  lastStatus?: 'success' | 'failed';
  createdAt: string;
  description?: string;
}

export const MOCK_WEBHOOKS: MockWebhook[] = [
  {
    id: 'wh-1',
    url: 'https://api.sendcloud.sc/v2/track-callback/webshop-crm',
    events: ['shipment.tracking_updated', 'shipment.delivered'],
    active: true,
    successRate: 0.998,
    deliveriesLast24h: 124,
    lastDeliveryAt: hoursAgo(0.05),
    lastStatus: 'success',
    createdAt: daysAgo(180),
    description: 'Sendcloud track-back voor PostNL/DHL/DPD shipments.',
  },
  {
    id: 'wh-2',
    url: 'https://webshop-crm.local/api/webhooks/bol-orders',
    events: ['order.created', 'order.cancelled'],
    active: true,
    successRate: 0.94,
    deliveriesLast24h: 18,
    lastDeliveryAt: hoursAgo(0.5),
    lastStatus: 'success',
    createdAt: daysAgo(120),
    description: 'Bol.com inbound order-events (ingekomen via VAS-poller).',
  },
  {
    id: 'wh-3',
    url: 'https://hooks.zapier.com/hooks/catch/12345/abcdef',
    events: ['stock.low_threshold'],
    active: true,
    successRate: 1,
    deliveriesLast24h: 4,
    lastDeliveryAt: hoursAgo(6),
    lastStatus: 'success',
    createdAt: daysAgo(40),
    description: 'Zapier-koppeling voor low-stock notificaties naar Slack #fulfillment.',
  },
  {
    id: 'wh-4',
    url: 'https://moneybird.com/api/v2/123456/webhooks/incoming',
    events: ['order.invoiced', 'refund.completed'],
    active: false,
    successRate: 0.62,
    deliveriesLast24h: 0,
    lastDeliveryAt: daysAgo(8),
    lastStatus: 'failed',
    createdAt: daysAgo(220),
    description: 'Moneybird-koppeling — momenteel uitgeschakeld i.v.m. duplicate factuur-issue.',
  },
];

/* ─── Helper: derive open/processing counts (for Sidebar badges) ────── */

export function getOrdersOpenCount(): number {
  return MOCK_ORDERS.filter((o) => o.status === 'open' || o.status === 'allocated' || o.status === 'picked').length;
}

export function getOrdersToShipCount(): number {
  return MOCK_ORDERS.filter((o) => o.status === 'allocated' || o.status === 'picked').length;
}

export function getReturnsOpenCount(): number {
  return MOCK_RETURNS.filter((r) => r.status === 'requested' || r.status === 'approved' || r.status === 'received').length;
}

/** Aggregate ledger by account for balance-cards. */
export function aggregateLedgerByAccount(): Array<{ accountCode: string; account: string; debit: number; credit: number; balance: number; entries: number }> {
  const map = new Map<string, { account: string; debit: number; credit: number; entries: number }>();
  for (const e of MOCK_LEDGER) {
    const cur = map.get(e.accountCode) ?? { account: e.account, debit: 0, credit: 0, entries: 0 };
    cur.debit += e.debit;
    cur.credit += e.credit;
    cur.entries += 1;
    map.set(e.accountCode, cur);
  }
  return Array.from(map.entries()).map(([accountCode, v]) => ({
    accountCode,
    account: v.account,
    debit: Math.round(v.debit * 100) / 100,
    credit: Math.round(v.credit * 100) / 100,
    balance: Math.round((v.debit - v.credit) * 100) / 100,
    entries: v.entries,
  })).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

/** Re-export low-stock count voor consistency met Aether's dashboard. */
export const MOCK_LOW_STOCK_COUNT = MOCK_STOCK_ROWS.filter((r) => r.lowStock).length;
