/**
 * Demo-seed-script — 50 demo-products met varianten + inventory.
 *
 *   Run: `pnpm --filter @webshop-crm/api db:seed-demo`
 *   (of vanaf root: `pnpm db:seed-demo`)
 *
 * Idempotent: producten met `slug` startend met 'demo-' worden gedetecteerd en
 * skip-execution. Re-run is veilig.
 *
 * Wat wordt geseed:
 *   - 50 producten over 5 product-types
 *   - 1-3 varianten per product (random)
 *   - 1 inventory_item + 1 inventory_level (op default-location 'main') per variant
 *   - random qty 0-100 (sommige 0 voor low-stock-test)
 *   - status: 80% active, 15% draft, 5% archived
 *   - 1-2 fake images-referenties per product (placeholder picsum-URLs)
 *
 * Voorwaarde:
 *   - default-location 'main' bestaat (`pnpm db:seed`)
 */
import { eq, like } from 'drizzle-orm';
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import {
  products,
  variants,
  productImages,
  inventoryItems,
  inventoryLevels,
  locations,
} from './schema/index.js';

// ─── Configuration ────────────────────────────────────────────

const PRODUCT_TYPES = [
  {
    code: 'KOF',
    label: 'Koffiemachines',
    titles: [
      'Espressomachine Pro',
      'Volautomaat Barista',
      'Bonen-tot-kop Deluxe',
      'Manuele Lever-machine',
      'Filterkoffie Master',
      'Capsule-machine Compact',
      'Espresso-set Italiano',
      'Koffiemolen Burr',
      'Melkopschuimer Auto',
      'Koffie-thermoskan',
    ],
    vendor: 'CoffeeCraft NL',
  },
  {
    code: 'HND',
    label: 'Hondenvoer',
    titles: [
      'Premium Adult Lam',
      'Puppy Voer Kip',
      'Senior Voer Vis',
      'Grain-free Wild',
      'Puppy Mini-bites',
      'Large Breed Power',
      'Hypoallergeen Eend',
      'Zalm + Aardappel',
      'Sterilized Diet',
      'Light + Fit',
    ],
    vendor: 'PetNutritie BV',
  },
  {
    code: 'KAN',
    label: 'Kantoor',
    titles: [
      'Bureaustoel Ergo',
      'Sta-zit Bureau Elektrisch',
      'Monitor-arm Dual',
      'Bureau-organizer',
      'LED-bureaulamp',
      'Voetensteun Verstelbaar',
      'Whiteboard 120x90',
      'Archiefkast 4-laden',
      'Pen-set Premium',
      'Notitieblok-pakket',
    ],
    vendor: 'OfficeWorks',
  },
  {
    code: 'TUI',
    label: 'Tuin',
    titles: [
      'Grasmaaier Elektrisch',
      'Heggenschaar Accu',
      'Tuinslang 25m',
      'Tuintafel + 4 stoelen',
      'Bloempot Set 3-delig',
      'Compostbak 300L',
      'Tuingereedschap-set',
      'Parasol 3m',
      'BBQ Houtskool Round',
      'Tuinslang-haspel',
    ],
    vendor: 'GreenThumb',
  },
  {
    code: 'KIT',
    label: 'Kitchen',
    titles: [
      'Pannenset 5-delig RVS',
      'Keukenmachine Multi',
      'Blender 1500W',
      'Ovenschotel Glas',
      'Messenset Damascus',
      'Kookmes 20cm',
      'Inductie-pan 28cm',
      'Wokpan Anti-aanbak',
      'Snijplank Bamboo',
      'Vacuummachine Sealer',
    ],
    vendor: 'KitchenMaster',
  },
] as const;

const STATUSES: Array<'active' | 'draft' | 'archived'> = [
  ...Array(80).fill('active'),
  ...Array(15).fill('draft'),
  ...Array(5).fill('archived'),
];

// Deterministic-but-varied random
function pickRandom<T>(arr: readonly T[], seed: number): T {
  return arr[seed % arr.length]!;
}

function randInt(min: number, max: number, seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  const f = x - Math.floor(x);
  return Math.floor(min + f * (max - min + 1));
}

function randPrice(seed: number): string {
  const min = 9.99;
  const max = 499.99;
  const x = Math.sin(seed * 7919 + 31337) * 233280;
  const f = Math.abs(x - Math.floor(x));
  return (min + f * (max - min)).toFixed(2);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Seed-flow ────────────────────────────────────────────────

async function ensureMainLocation(): Promise<string> {
  const rows = await db.select().from(locations).where(eq(locations.code, 'main')).limit(1);
  if (rows.length === 0) {
    throw new Error(
      "default-location 'main' bestaat niet — run eerst `pnpm db:seed`.",
    );
  }
  return rows[0]!.id;
}

async function alreadySeeded(): Promise<boolean> {
  const existing = await db
    .select({ id: products.id })
    .from(products)
    .where(like(products.slug, 'demo-%'))
    .limit(1);
  return existing.length > 0;
}

async function seedDemoProducts(mainLocationId: string): Promise<void> {
  let productSeed = 0;
  let totalVariants = 0;
  let totalImages = 0;

  for (let typeIdx = 0; typeIdx < PRODUCT_TYPES.length; typeIdx++) {
    const type = PRODUCT_TYPES[typeIdx]!;
    for (let i = 0; i < 10; i++) {
      productSeed++;
      const titleBase = type.titles[i % type.titles.length]!;
      const title = `Demo ${titleBase} ${productSeed}`;
      const slug = `demo-${slugify(titleBase)}-${productSeed}`;
      const status = STATUSES[productSeed % STATUSES.length]!;

      // Insert product
      const [prod] = await db
        .insert(products)
        .values({
          slug,
          title,
          descriptionHtml: `<p>${title} — demo-product gegenereerd door seed-demo.</p>`,
          vendor: type.vendor,
          productType: type.label,
          status,
          tags: ['demo', type.code.toLowerCase()],
          publishedAt: status === 'active' ? new Date() : null,
        })
        .returning({ id: products.id });

      const productId = prod!.id;

      // 1-3 variants
      const variantCount = randInt(1, 3, productSeed * 13);
      for (let v = 0; v < variantCount; v++) {
        const variantSeed = productSeed * 100 + v;
        const sku = `${type.code}-${String(productSeed).padStart(3, '0')}-${v + 1}`;
        const price = randPrice(variantSeed);

        const [variant] = await db
          .insert(variants)
          .values({
            productId,
            sku,
            price,
            position: v,
            active: true,
            taxClass: 'standard',
            selectedOptions:
              variantCount > 1 ? { size: ['S', 'M', 'L'][v]! } : {},
          })
          .returning({ id: variants.id });

        const variantId = variant!.id;
        totalVariants++;

        // Inventory item
        const [item] = await db
          .insert(inventoryItems)
          .values({
            variantId,
            sku,
            tracked: true,
            requiresShipping: true,
          })
          .returning({ id: inventoryItems.id });

        const itemId = item!.id;

        // Inventory level
        const qty = randInt(0, 100, variantSeed * 7);
        await db.insert(inventoryLevels).values({
          itemId,
          locationId: mainLocationId,
          onHand: qty,
          available: qty,
          committed: 0,
          incoming: 0,
          minStock: 5,
          reorderPoint: 10,
          reorderQty: 50,
        });
      }

      // 1-2 fake images
      const imgCount = randInt(1, 2, productSeed * 17);
      const firstSku = `${type.code}-${String(productSeed).padStart(3, '0')}-1`;
      for (let p = 0; p < imgCount; p++) {
        await db.insert(productImages).values({
          productId,
          url: `https://picsum.photos/seed/${firstSku}-${p}/600/600`,
          alt: `${title} — afbeelding ${p + 1}`,
          position: p,
        });
        totalImages++;
      }
    }
  }

  logger.info(
    {
      products: productSeed,
      variants: totalVariants,
      images: totalImages,
    },
    'demo-products seeded',
  );
}

async function main() {
  logger.info('Seeding demo-products…');

  if (await alreadySeeded()) {
    logger.info('Demo-products bestaan al (slug LIKE demo-%) — skip.');
    return;
  }

  const mainLocationId = await ensureMainLocation();
  await seedDemoProducts(mainLocationId);

  logger.info('Demo-seed OK.');
}

main()
  .catch((err) => {
    logger.error({ err }, 'Demo-seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
