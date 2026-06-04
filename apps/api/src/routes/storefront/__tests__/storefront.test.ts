/**
 * Storefront E2E â€” tegen de ECHTE Postgres (:7432).
 *
 * Flow:
 *   1. Seed: maak test-shop + product + variant + inventory + publiceer in shop,
 *      + CMS-page + blog-post + menu.
 *   2. GET /shop, GET /products (ziet product), GET /products/:slug (variants+images).
 *   3. GET /pages/:slug, /menus, /blog, /blog/:slug.
 *   4. POST /cart â†’ token; POST items (voorraad-check); checkout â†’ order ontstaat.
 *   5. Verifieer order + order_items + payment(paid) in DB; voorraad gedecrementeerd.
 *   6. Teardown: verwijder alle test-rijen (cascade waar mogelijk).
 *
 * Idempotent: gebruikt een unieke shop-slug per run en ruimt alles op in
 * afterAll, ook bij falen halverwege.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { db, closeDb } from '../../../lib/db.js';
import {
  shops,
  shopProducts,
  products,
  variants,
  productImages,
  inventoryItems,
  inventoryLevels,
  locations,
  cmsPages,
  cmsMenus,
  cmsMenuItems,
  blogPosts,
  carts,
  customers,
  orders,
} from '../../../db/schema/index.js';
import { storefrontRoutes } from '../index.js';

const RUN = Date.now().toString(36);
const SHOP_SLUG = `sf-test-${RUN}`;
const PRODUCT_SLUG = `sf-prod-${RUN}`;
const TEST_EMAIL = `buyer-${RUN}@example.com`;

let shopId: string;
let productId: string;
let variantId: string;
let locationId: string;
let itemId: string;

function app() {
  const a = new Hono();
  a.route('/api/storefront/v1', storefrontRoutes);
  return a;
}

/** Helper: request met shop-slug header. */
function req(
  a: ReturnType<typeof app>,
  path: string,
  init?: RequestInit,
): Response | Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('X-Shop-Slug', SHOP_SLUG);
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return a.request(`/api/storefront/v1${path}`, { ...init, headers });
}

beforeAll(async () => {
  // Location (nodig voor inventory_levels).
  const [loc] = await db
    .insert(locations)
    .values({
      code: `SF-LOC-${RUN}`,
      name: 'SF Test Warehouse',
      type: 'warehouse',
    })
    .returning();
  locationId = loc!.id;

  // Shop (active).
  const [shop] = await db
    .insert(shops)
    .values({ slug: SHOP_SLUG, name: 'SF Test Shop', status: 'active' })
    .returning();
  shopId = shop!.id;

  // Product + variant.
  const [prod] = await db
    .insert(products)
    .values({
      slug: PRODUCT_SLUG,
      title: 'SF Demo Coffee',
      status: 'active',
      descriptionHtml: '<p>Lekker</p>',
      tags: ['demo', 'coffee'],
    })
    .returning();
  productId = prod!.id;

  const [variant] = await db
    .insert(variants)
    .values({
      productId,
      sku: `SF-SKU-${RUN}`,
      price: '12.5000',
      compareAtPrice: '15.0000',
      costPrice: '5.0000',
      taxClass: 'standard',
      active: true,
    })
    .returning();
  variantId = variant!.id;

  await db.insert(productImages).values({
    productId,
    url: '/storage/images/demo.jpg',
    alt: 'demo',
    position: 0,
  });

  // Inventory: item + level (10 available op de location).
  const [item] = await db
    .insert(inventoryItems)
    .values({ variantId, sku: `SF-SKU-${RUN}`, tracked: true })
    .returning();
  itemId = item!.id;
  await db.insert(inventoryLevels).values({
    itemId,
    locationId,
    onHand: 10,
    available: 10,
    committed: 0,
  });

  // Publiceer in shop met price_override.
  await db.insert(shopProducts).values({
    shopId,
    productId,
    published: true,
    priceOverride: '11.0000',
    position: 0,
    publishedAt: new Date(),
  });

  // CMS: page (published) + menu + item + blog (published).
  await db.insert(cmsPages).values({
    shopId,
    slug: 'about',
    title: 'Over ons',
    status: 'published',
    blocks: [{ type: 'richtext', text: 'hi' }],
    publishedAt: new Date(),
  });
  const [menu] = await db
    .insert(cmsMenus)
    .values({ shopId, location: 'header', name: 'Hoofdmenu' })
    .returning();
  await db.insert(cmsMenuItems).values({
    menuId: menu!.id,
    label: 'Home',
    url: '/',
    position: 0,
  });
  await db.insert(blogPosts).values({
    shopId,
    slug: 'hello',
    title: 'Hello world',
    status: 'published',
    bodyHtml: '<p>body</p>',
    excerpt: 'intro',
    publishedAt: new Date(),
  });
});

afterAll(async () => {
  // Teardown â€” verwijder in FK-veilige volgorde. Orders/customers/carts van
  // de shop cascaden grotendeels, maar we ruimen expliciet op.
  try {
    if (shopId) {
      // orders (+ items/payments cascade) van deze shop
      const shopOrders = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.shopId, shopId));
      if (shopOrders.length > 0) {
        await db.delete(orders).where(
          inArray(
            orders.id,
            shopOrders.map((o) => o.id),
          ),
        );
      }
      await db.delete(carts).where(eq(carts.shopId, shopId));
      await db.delete(customers).where(eq(customers.shopId, shopId));
      // shop_products + cms via cascade op shop-delete; maar verwijder shop
      // pas na product (shop_products cascade op shop).
      await db.delete(shopProducts).where(eq(shopProducts.shopId, shopId));
    }
    if (itemId) {
      await db.delete(inventoryLevels).where(eq(inventoryLevels.itemId, itemId));
      await db.delete(inventoryItems).where(eq(inventoryItems.id, itemId));
    }
    if (productId) {
      // product cascade verwijdert variants + images
      await db.delete(products).where(eq(products.id, productId));
    }
    if (shopId) {
      // shop cascade verwijdert cms_* + blog + menus + shop_products restanten
      await db.delete(shops).where(eq(shops.id, shopId));
    }
    if (locationId) {
      await db.delete(locations).where(eq(locations.id, locationId));
    }
  } finally {
    await closeDb();
  }
});

describe('storefront shop-scoping', () => {
  it('400 zonder shop-identifier', async () => {
    const a = app();
    const res = await a.request('/api/storefront/v1/products');
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('shop_required');
  });

  it('404 onbekende shop', async () => {
    const a = app();
    const res = await a.request('/api/storefront/v1/products?shop=does-not-exist-xyz');
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe('shop_not_found');
  });

  it('GET /shop geeft publiek subset', async () => {
    const res = await req(app(), '/shop');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.shop.slug).toBe(SHOP_SLUG);
  });
});

describe('storefront catalog', () => {
  it('GET /products toont gepubliceerd product met price_override', async () => {
    const res = await req(app(), '/products');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBeGreaterThanOrEqual(1);
    const mine = body.items.find((p: any) => p.slug === PRODUCT_SLUG);
    expect(mine).toBeTruthy();
    expect(mine.price).toBe('11.0000'); // override toegepast
    expect(mine.primaryImageUrl).toBe('/storage/images/demo.jpg');
  });

  it('GET /products/:slug detail met variants + voorraad', async () => {
    const res = await req(app(), `/products/${PRODUCT_SLUG}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.product.slug).toBe(PRODUCT_SLUG);
    expect(body.product.variants).toHaveLength(1);
    expect(body.product.variants[0].price).toBe('11.0000');
    expect(body.product.variants[0].available).toBe(10);
    expect(body.product.variants[0].inStock).toBe(true);
    expect(body.product.images).toHaveLength(1);
  });

  it('404 onbekend product-slug', async () => {
    const res = await req(app(), '/products/nope-nope');
    expect(res.status).toBe(404);
  });
});

describe('storefront content', () => {
  it('GET /pages/:slug', async () => {
    const res = await req(app(), '/pages/about');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.page.title).toBe('Over ons');
  });

  it('GET /menus genest', async () => {
    const res = await req(app(), '/menus');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.menus.length).toBeGreaterThanOrEqual(1);
    expect(body.menus[0].items[0].label).toBe('Home');
  });

  it('GET /blog + /blog/:slug', async () => {
    const list = await req(app(), '/blog');
    expect(list.status).toBe(200);
    expect(((await list.json()) as any).items.length).toBeGreaterThanOrEqual(1);

    const detail = await req(app(), '/blog/hello');
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as any;
    expect(body.post.bodyHtml).toBe('<p>body</p>');
  });
});

describe('storefront cart + checkout', () => {
  it('volledige flow: cart â†’ add â†’ checkout â†’ order', async () => {
    const a = app();

    // 1. cart
    const createRes = await req(a, '/cart', { method: 'POST' });
    expect(createRes.status).toBe(201);
    const token = ((await createRes.json()) as any).cart.token as string;
    expect(token).toBeTruthy();

    // 2. add item (qty 2)
    const addRes = await req(a, `/cart/${token}/items`, {
      method: 'POST',
      body: JSON.stringify({ variantId, quantity: 2 }),
    });
    expect(addRes.status).toBe(201);
    const cartBody = (await addRes.json()) as any;
    expect(cartBody.cart.itemCount).toBe(2);
    expect(cartBody.cart.subtotal).toBe('22.0000'); // 11 * 2

    // 3. voorraad-check: meer dan beschikbaar â†’ 422
    const tooMany = await req(a, `/cart/${token}/items`, {
      method: 'POST',
      body: JSON.stringify({ variantId, quantity: 999 }),
    });
    expect(tooMany.status).toBe(422);
    expect(((await tooMany.json()) as any).error).toBe('insufficient_stock');

    // 4. checkout
    const checkoutRes = await req(a, `/cart/${token}/checkout`, {
      method: 'POST',
      body: JSON.stringify({
        email: TEST_EMAIL,
        firstName: 'Test',
        lastName: 'Koper',
        shippingAddress: {
          line1: 'Teststraat 1',
          postcode: '1234 AB',
          city: 'Amsterdam',
          country: 'NL',
        },
        shippingTotal: '4.9500',
      }),
    });
    expect(checkoutRes.status).toBe(201);
    const orderBody = (await checkoutRes.json()) as any;
    expect(orderBody.order.orderNumber).toMatch(/^SF-\d+$/);
    expect(orderBody.order.financialStatus).toBe('paid');
    expect(orderBody.order.grandTotal).toBe('26.9500'); // 22 + 4.95
    expect(orderBody.payment.status).toBe('paid');

    // 5. verifieer in DB: order + customer + voorraad-decrement
    const [orderRow] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.shopId, shopId), eq(orders.email, TEST_EMAIL)))
      .limit(1);
    expect(orderRow).toBeTruthy();
    expect(orderRow!.financialStatus).toBe('paid');

    const [cust] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.shopId, shopId), eq(customers.email, TEST_EMAIL)))
      .limit(1);
    expect(cust).toBeTruthy();
    expect(cust!.ordersCount).toBe(1);
    expect(cust!.totalSpent).toBe('26.9500');

    const [level] = await db
      .select()
      .from(inventoryLevels)
      .where(eq(inventoryLevels.itemId, itemId))
      .limit(1);
    expect(level!.available).toBe(8); // 10 - 2
    expect(level!.committed).toBe(2);

    // cart is geleegd na checkout
    const afterCart = await req(a, `/cart/${token}`);
    expect(afterCart.status).toBe(200);
    expect(((await afterCart.json()) as any).cart.itemCount).toBe(0);
  });
});
