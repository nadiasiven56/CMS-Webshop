/**
 * Mock-data laag voor demo-mode (V1).
 *
 * Backend draait niet altijd (geen Postgres). Deze module produceert
 * realistische demo-data zodat de polished UI altijd zichtbaar is.
 *
 * Toggle via `VITE_DEMO_MODE` (default FALSE — admin praat met de echte
 * API). Wanneer aan: API-calls worden niet gedaan, hooks resolven direct
 * met mock-data. Alleen expliciet aanzetten voor een UI-demo zonder backend.
 */

import type { Shop } from './shop-context';

export const DEMO_MODE: boolean =
  (import.meta.env.VITE_DEMO_MODE ?? 'false').toString().toLowerCase() === 'true';

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
  // Stable pseudo-uuid for demo
  const r = seededRand(`${seed}-${n}`);
  const hex = (len: number) =>
    Array.from({ length: len }, () => Math.floor(r() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}

const VENDORS = [
  'La Pavoni',
  'Rocket',
  'Lelit',
  'Profitec',
  'ECM',
  'Bezzera',
  'Quick Mill',
  'Ascaso',
  'Eureka',
  'Mahlkönig',
] as const;

const TYPES = [
  'Espressomachine',
  'Koffiemolen',
  'Accessoire',
  'Tamper',
  'Filter',
  'Onderhoud',
  'Bonen',
] as const;

const ADJECTIVES = [
  'Stradivari',
  'Apartamento',
  'Mara X',
  'Pro 700',
  'Synchronika',
  'Magister',
  'BFC Royal',
  'Atom',
  'Mignon',
  'EK43',
  'Linea',
  'Speedster',
  'Slayer',
  'Strega',
  'Gaggia',
] as const;

const COLORS = ['Chrome', 'Black', 'Copper', 'Steel', 'White', 'Olive', 'Wood'] as const;

const STATUS_DIST: Array<'active' | 'draft' | 'archived'> = [
  'active', 'active', 'active', 'active', 'active', 'active',
  'active', 'active', 'draft', 'draft', 'archived',
];

const REASONS = ['receive', 'sale', 'return', 'damage', 'loss', 'audit', 'manual', 'adjust', 'transfer', 'po_receive'] as const;

const LOCATIONS = [
  { id: 'loc-warehouse-nl', code: 'WH-NL', name: 'Warehouse Rotterdam', type: 'warehouse' },
  { id: 'loc-store-utrecht', code: 'ST-UTR', name: 'Showroom Utrecht', type: 'store' },
  { id: 'loc-supplier', code: 'SUP', name: 'In-transit (suppliers)', type: 'transit' },
] as const;

/* ─── Demo products ──────────────────────────────────────────────────── */

export interface MockProductListItem {
  id: string;
  title: string;
  slug: string;
  vendor: string;
  productType: string;
  status: 'active' | 'draft' | 'archived';
  variantCount: number;
  primaryImageUrl: string | null;
  updatedAt: string;
  // extra demo-only fields (not in real ProductListItem)
  availableTotal: number;
  pricePrimary: number;
  tags: string[];
}

export interface MockVariantDto {
  id: string;
  productId: string;
  sku: string | null;
  title: string;
  price: number | null;
  compareAtPrice: number | null;
  costPrice: number | null;
  weightGrams: number | null;
  position: number;
  optionValues: Record<string, string>;
}

export interface MockProductImageDto {
  id: string;
  productId: string;
  url: string;
  altText: string | null;
  position: number;
}

export interface MockProductWithRelations extends MockProductListItem {
  descriptionHtml: string | null;
  variants: MockVariantDto[];
  images: MockProductImageDto[];
  options: Array<{ id: string; name: string; position: number }>;
}

function buildProduct(seed: number): MockProductWithRelations {
  const rng = seededRand(`prod-${seed}`);
  const adj = pick(rng, ADJECTIVES);
  const vendor = pick(rng, VENDORS);
  const type = pick(rng, TYPES);
  const title = `${vendor} ${adj}`;
  const slug = `${vendor}-${adj}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const status = STATUS_DIST[Math.floor(rng() * STATUS_DIST.length)]!;
  const id = uuid('prod', seed);
  const sku = `SKU-${String(seed).padStart(4, '0')}`;
  const basePrice = Math.round((300 + rng() * 2400) * 100) / 100;

  const colors = [pick(rng, COLORS), pick(rng, COLORS), pick(rng, COLORS)];
  const variantCount = 1 + Math.floor(rng() * 3); // 1-3
  const variants: MockVariantDto[] = Array.from({ length: variantCount }, (_, i) => {
    const optVals: Record<string, string> = {};
    if (variantCount > 1) optVals.Color = colors[i] ?? '';
    return {
      id: uuid(`var-${seed}`, i),
      productId: id,
      sku: variantCount === 1 ? sku : `${sku}-${colors[i]?.slice(0, 3).toUpperCase()}`,
      title: variantCount === 1 ? 'Default' : (colors[i] ?? 'Default'),
      price: Math.round(basePrice * (1 + i * 0.05) * 100) / 100,
      compareAtPrice:
        i === 0 && rng() > 0.7 ? Math.round(basePrice * 1.15 * 100) / 100 : null,
      costPrice: Math.round(basePrice * 0.55 * 100) / 100,
      weightGrams: Math.floor(2000 + rng() * 18000),
      position: i,
      optionValues: optVals,
    };
  });

  const imageCount = rng() > 0.15 ? 1 + Math.floor(rng() * 3) : 0;
  const images: MockProductImageDto[] = Array.from({ length: imageCount }, (_, i) => ({
    id: uuid(`img-${seed}`, i),
    productId: id,
    url: `https://picsum.photos/seed/${sku}-${i}/600/600`,
    altText: title,
    position: i,
  }));

  const tags = [
    type.toLowerCase(),
    vendor.toLowerCase().replace(/\s+/g, '-'),
    rng() > 0.5 ? 'featured' : '',
  ].filter(Boolean) as string[];

  // ms back random within last 60 days
  const updatedAtMs = Date.now() - Math.floor(rng() * 60 * 24 * 3600 * 1000);

  return {
    id,
    title,
    slug,
    vendor,
    productType: type,
    status,
    variantCount: variants.length,
    primaryImageUrl: images[0]?.url ?? null,
    updatedAt: new Date(updatedAtMs).toISOString(),
    availableTotal: Math.floor(rng() * 30),
    pricePrimary: variants[0]?.price ?? basePrice,
    tags,
    descriptionHtml: `<p>De <strong>${title}</strong> combineert klassieke vakkunde met moderne extractie-controle. Geschikt voor zowel beginnende barista's als professionele cafés. Levering binnen 2-5 werkdagen.</p><ul><li>Boiler: dual</li><li>Druk: 9 bar</li><li>Garantie: 2 jaar</li></ul>`,
    variants,
    images,
    options: variantCount > 1 ? [{ id: uuid(`opt-${seed}`, 0), name: 'Color', position: 0 }] : [],
  };
}

/** Seeded list of 50 products, deterministisch. */
export const MOCK_PRODUCTS: MockProductWithRelations[] = Array.from(
  { length: 50 },
  (_, i) => buildProduct(i + 1),
);

export function getMockProduct(id: string): MockProductWithRelations | undefined {
  return MOCK_PRODUCTS.find((p) => p.id === id);
}

/* ─── Stock items ────────────────────────────────────────────────────── */

export interface MockStockItemRow {
  itemId: string;
  sku: string;
  productTitle: string | null;
  productId: string | null;
  variantSku: string | null;
  onHandTotal: number;
  availableTotal: number;
  committedTotal: number;
  incomingTotal: number;
  locationsCount: number;
  lowStock: boolean;
  // extra
  costPrice: number;
  minStock: number;
}

function buildStockRow(p: MockProductWithRelations, v: MockVariantDto, n: number): MockStockItemRow {
  const rng = seededRand(`stock-${v.id}`);
  const onHand = Math.floor(rng() * 40);
  const committed = Math.floor(rng() * Math.min(onHand, 8));
  const available = Math.max(0, onHand - committed);
  const incoming = rng() > 0.7 ? Math.floor(rng() * 12) : 0;
  const minStock = 5;
  return {
    itemId: uuid(`stockitem-${n}`, n),
    sku: v.sku ?? `SKU-${n}`,
    productTitle: p.title,
    productId: p.id,
    variantSku: v.sku,
    onHandTotal: onHand,
    availableTotal: available,
    committedTotal: committed,
    incomingTotal: incoming,
    locationsCount: 1 + Math.floor(rng() * 3),
    lowStock: available <= minStock,
    costPrice: v.costPrice ?? 100,
    minStock,
  };
}

export const MOCK_STOCK_ROWS: MockStockItemRow[] = MOCK_PRODUCTS.flatMap((p, i) =>
  p.variants.map((v, vi) => buildStockRow(p, v, i * 10 + vi)),
);

export function getMockStockItem(itemId: string): MockStockItemDetail | undefined {
  const row = MOCK_STOCK_ROWS.find((r) => r.itemId === itemId);
  if (!row) return undefined;
  const product = MOCK_PRODUCTS.find((p) => p.id === row.productId);
  const variant = product?.variants.find((v) => v.sku === row.variantSku);
  const rng = seededRand(`detail-${itemId}`);

  // Distribute stock across 1-3 locations
  const locCount = row.locationsCount;
  const locations = LOCATIONS.slice(0, locCount).map((loc) => {
    const onHand = Math.floor(row.onHandTotal / locCount + rng() * 4);
    const committed = Math.floor(row.committedTotal / locCount);
    const available = Math.max(0, onHand - committed);
    const minStock = 5;
    return {
      locationId: loc.id,
      code: loc.code,
      name: loc.name,
      type: loc.type,
      onHand,
      available,
      committed,
      incoming: 0,
      minStock,
      reorderPoint: 8,
      reorderQty: 20,
      lowStock: available <= minStock,
    };
  });

  const recentMovements = Array.from({ length: 8 }, (_, i) => ({
    id: uuid(`mov-${itemId}`, i),
    itemId,
    itemSku: row.sku,
    location: { id: locations[0]!.locationId, code: locations[0]!.code, name: locations[0]!.name },
    delta: pick(rng, [+5, -1, -2, +10, -3, +1, -1, +20]),
    reason: pick(rng, REASONS),
    refType: null,
    refId: null,
    actor: { id: uuid('user', 0), email: 'admin@webshop-crm.local' },
    note: i === 0 ? 'Eerste ontvangst' : null,
    createdAt: new Date(Date.now() - i * 3600 * 1000 * 6).toISOString(),
  }));

  return {
    itemId,
    sku: row.sku,
    tracked: true,
    requiresShipping: true,
    gtin: null,
    hsCode: null,
    countryOfOrigin: 'IT',
    variant: variant ? { id: variant.id, sku: variant.sku } : null,
    product: product ? { id: product.id, title: product.title, status: product.status } : null,
    totals: {
      onHand: row.onHandTotal,
      available: row.availableTotal,
      committed: row.committedTotal,
      incoming: row.incomingTotal,
    },
    locations,
    recentMovements,
  };
}

export interface MockStockItemDetail {
  itemId: string;
  sku: string;
  tracked: boolean;
  requiresShipping: boolean;
  gtin: string | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  variant: { id: string; sku: string | null } | null;
  product: { id: string; title: string | null; status: string | null } | null;
  totals: { onHand: number; available: number; committed: number; incoming: number };
  locations: Array<{
    locationId: string;
    code: string;
    name: string;
    type: string;
    onHand: number;
    available: number;
    committed: number;
    incoming: number;
    minStock: number | null;
    reorderPoint: number | null;
    reorderQty: number | null;
    lowStock: boolean;
  }>;
  recentMovements: Array<{
    id: string;
    itemId: string;
    itemSku: string | null;
    location: { id: string | null; code: string | null; name: string | null };
    delta: number;
    reason: string;
    refType: string | null;
    refId: string | null;
    actor: { id: string; email: string | null } | null;
    note: string | null;
    createdAt: string;
  }>;
}

/* ─── Movements global feed ──────────────────────────────────────────── */

export const MOCK_MOVEMENTS = (() => {
  const rng = seededRand('global-mov');
  const list = Array.from({ length: 80 }, (_, i) => {
    const row = MOCK_STOCK_ROWS[i % MOCK_STOCK_ROWS.length]!;
    return {
      id: uuid('global-mov', i),
      itemId: row.itemId,
      itemSku: row.sku,
      location: {
        id: LOCATIONS[i % LOCATIONS.length]!.id,
        code: LOCATIONS[i % LOCATIONS.length]!.code,
        name: LOCATIONS[i % LOCATIONS.length]!.name,
      },
      delta: pick(rng, [+5, -1, -2, +10, -3, +1, -1, +20, -5, +2]),
      reason: pick(rng, REASONS),
      refType: null as string | null,
      refId: null as string | null,
      actor: { id: uuid('user', 0), email: 'admin@webshop-crm.local' },
      note: rng() > 0.7 ? 'Inboeking via dock' : null,
      createdAt: new Date(Date.now() - i * 1.5 * 3600 * 1000).toISOString(),
    };
  });
  return list;
})();

/* ─── Dashboard KPIs ─────────────────────────────────────────────────── */

export interface DashboardKpis {
  revenue30d: number;
  revenue30dDelta: number; // pct vs vorige periode
  revenueSeries: Array<{ day: string; revenue: number }>;
  openOrders: number;
  openOrdersUnpaid: number;
  openOrdersToShip: number;
  lowStockCount: number;
  lowStockTop: Array<{ sku: string; available: number; productTitle: string }>;
  topProducts: Array<{ title: string; revenue: number }>;
  channels: Array<{ name: string; status: 'connected' | 'warning' | 'error'; lastSync: string }>;
  recentActivity: Array<{
    id: string;
    type: 'order' | 'stock' | 'login' | 'product';
    actor: string;
    text: string;
    timestamp: string;
  }>;
}

export const MOCK_KPIS: DashboardKpis = (() => {
  const rng = seededRand('kpis');
  const revenueSeries = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.now() - (29 - i) * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    return {
      day,
      revenue: Math.round(800 + rng() * 2400 + (i > 20 ? 600 : 0)),
    };
  });
  const revenue30d = revenueSeries.reduce((s, d) => s + d.revenue, 0);
  const lowStock = MOCK_STOCK_ROWS.filter((r) => r.lowStock);
  const topProducts = [...MOCK_PRODUCTS]
    .filter((p) => p.status === 'active')
    .slice(0, 5)
    .map((p, i) => ({
      title: p.title,
      revenue: Math.round(p.pricePrimary * (8 - i * 1.2)),
    }));

  return {
    revenue30d,
    revenue30dDelta: 12.4,
    revenueSeries,
    openOrders: 14,
    openOrdersUnpaid: 3,
    openOrdersToShip: 8,
    lowStockCount: lowStock.length,
    lowStockTop: lowStock.slice(0, 3).map((r) => ({
      sku: r.sku,
      available: r.availableTotal,
      productTitle: r.productTitle ?? r.sku,
    })),
    topProducts,
    channels: [
      { name: 'Google Merchant Center', status: 'connected', lastSync: '12 min geleden' },
      { name: 'Bol.com', status: 'connected', lastSync: '34 min geleden' },
      { name: 'Amazon NL', status: 'warning', lastSync: '6 uur geleden' },
      { name: 'Webshop (eigen)', status: 'connected', lastSync: '2 min geleden' },
    ],
    recentActivity: [
      { id: '1', type: 'order', actor: 'Storefront', text: 'Order #24018 ontvangen — €1.245,00', timestamp: minsAgo(2) },
      { id: '2', type: 'stock', actor: 'admin@webshop-crm.local', text: 'Voorraad +20 SKU-0042 (Receive)', timestamp: minsAgo(11) },
      { id: '3', type: 'product', actor: 'admin@webshop-crm.local', text: 'Product La Pavoni Stradivari geactiveerd', timestamp: minsAgo(34) },
      { id: '4', type: 'order', actor: 'Storefront', text: 'Order #24017 betaald — €389,00', timestamp: minsAgo(58) },
      { id: '5', type: 'stock', actor: 'admin@webshop-crm.local', text: 'Voorraad -3 SKU-0011 (Damage)', timestamp: minsAgo(126) },
      { id: '6', type: 'login', actor: 'admin@webshop-crm.local', text: 'Ingelogd vanuit Rotterdam', timestamp: minsAgo(180) },
      { id: '7', type: 'product', actor: 'admin@webshop-crm.local', text: 'Foto toegevoegd aan ECM Synchronika', timestamp: minsAgo(240) },
      { id: '8', type: 'order', actor: 'Storefront', text: 'Order #24016 verzonden — track #NL00329…', timestamp: minsAgo(310) },
      { id: '9', type: 'stock', actor: 'admin@webshop-crm.local', text: 'Voorraad-audit afgerond — 3 correcties', timestamp: minsAgo(720) },
      { id: '10', type: 'product', actor: 'admin@webshop-crm.local', text: 'Prijswijziging Lelit Mara X', timestamp: minsAgo(1280) },
    ],
  };
})();

function minsAgo(min: number): string {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

/** Seed-mock auth-user wanneer demo. */
export const MOCK_USER = {
  id: 'demo-user-1',
  email: 'admin@webshop-crm.local',
  role: 'admin',
} as const;

/** Demo-creds tonen op login-page. */
export const DEMO_CREDENTIALS = {
  email: 'admin@webshop-crm.local',
  password: 'demo123',
} as const;

/** Demo-winkels — laat de multi-store launcher + shop-switcher werken zonder backend. */
export const MOCK_SHOPS: Shop[] = [
  {
    id: 'shop-crema',
    slug: 'crema-co',
    name: 'Crema & Co.',
    domain: 'crema.nl',
    locale: 'nl-NL',
    currency: 'EUR',
    status: 'active',
    branding: { emoji: '☕' },
    supportEmail: 'hallo@crema.nl',
  },
  {
    id: 'shop-pawfect',
    slug: 'pawfect',
    name: 'Pawfect',
    domain: 'pawfect.nl',
    locale: 'nl-NL',
    currency: 'EUR',
    status: 'active',
    branding: { emoji: '🐶' },
    supportEmail: 'hallo@pawfect.nl',
  },
  {
    id: 'shop-nadia',
    slug: 'nadias-babies',
    name: "Nadia's Babies",
    domain: 'nadiasbabies.nl',
    locale: 'nl-NL',
    currency: 'EUR',
    status: 'active',
    branding: { emoji: '👶' },
    supportEmail: 'hallo@nadiasbabies.nl',
  },
  {
    id: 'shop-bombshell',
    slug: 'bombshell',
    name: 'Bombshell',
    domain: 'bombshell.nl',
    locale: 'nl-NL',
    currency: 'EUR',
    status: 'draft',
    branding: { emoji: '👙' },
    supportEmail: null,
  },
];
