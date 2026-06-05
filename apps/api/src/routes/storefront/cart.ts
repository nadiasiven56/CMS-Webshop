/**
 * Storefront cart (server-side, via carts.token).
 *
 *   POST   /cart                      — maak nieuwe cart, geef token terug.
 *   GET    /cart/:token               — haal cart op (met regels + voorraad).
 *   POST   /cart/:token/items         — add item (variant + qty), voorraad-check.
 *   PATCH  /cart/:token/items/:itemId — wijzig qty (voorraad-check).
 *   DELETE /cart/:token/items/:itemId — verwijder regel.
 *   DELETE /cart/:token/items         — leeg de cart.
 *
 * Token = ondoordringbare random string (publieke handle). Cart is shop-scoped:
 * de token MOET bij de huidige shop horen, anders 404 (geen cross-shop lekken).
 */
import type { Context } from 'hono';
import { randomBytes } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import {
  carts,
  cartItems,
  variants,
  products,
  productImages,
  shopProducts,
  type Shop,
  type Cart,
} from '../../db/schema/index.js';
import { availableByVariant, effectivePrice, lineTotal, sumMoney } from './_pricing.js';
import {
  toStorefrontCart,
  type StorefrontCartLineDto,
} from './_serialize.js';
import { isUuid } from './_shop.js';

const CART_TTL_DAYS = 30;

function newToken(): string {
  return randomBytes(24).toString('base64url'); // ~32 chars, url-safe
}

/**
 * Laad cart op token, scoped op shop. Null als niet gevonden / andere shop /
 * VERLOPEN (expiresAt in het verleden) — een verlopen cart mag niet meer
 * gebruikt/afgerekend worden.
 */
async function loadCart(shopId: string, token: string): Promise<Cart | null> {
  const [cart] = await db
    .select()
    .from(carts)
    .where(
      and(
        eq(carts.token, token),
        eq(carts.shopId, shopId),
        or(isNull(carts.expiresAt), gt(carts.expiresAt, new Date())),
      ),
    )
    .limit(1);
  return cart ?? null;
}

/**
 * Bouw de volledige cart-DTO: laad regels, join variant→product voor titel/sku,
 * pas shop price_override toe, bereken voorraad + subtotal.
 */
async function buildCartDto(shop: Shop, cart: Cart) {
  const rows = await db
    .select({
      itemId: cartItems.id,
      variantId: cartItems.variantId,
      quantity: cartItems.quantity,
      unitPrice: cartItems.unitPrice,
      variantSku: variants.sku,
      variantPrice: variants.price,
      productId: variants.productId,
      productTitle: products.title,
    })
    .from(cartItems)
    .innerJoin(variants, eq(variants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(cartItems.cartId, cart.id))
    .orderBy(asc(cartItems.id));

  const variantIds = rows.map((r) => r.variantId);
  const availMap = await availableByVariant(variantIds);

  // primary image per product
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const imageByProduct = new Map<string, string>();
  if (productIds.length > 0) {
    const imgs = await db
      .select({
        productId: productImages.productId,
        url: productImages.url,
        position: productImages.position,
      })
      .from(productImages)
      .where(inArray(productImages.productId, productIds))
      .orderBy(asc(productImages.position));
    for (const img of imgs) {
      if (!imageByProduct.has(img.productId)) imageByProduct.set(img.productId, img.url);
    }
  }

  const lines: StorefrontCartLineDto[] = rows.map((r) => {
    // unit_price gesnapshot bij add; val terug op live effectieve prijs.
    const unit = r.unitPrice ?? r.variantPrice;
    return {
      id: r.itemId,
      variantId: r.variantId,
      sku: r.variantSku,
      title: r.productTitle,
      quantity: r.quantity,
      unitPrice: unit,
      lineTotal: lineTotal(unit, r.quantity),
      available: availMap.get(r.variantId) ?? 0,
      imageUrl: imageByProduct.get(r.productId) ?? null,
    };
  });

  const subtotal = sumMoney(lines.map((l) => l.lineTotal));
  return toStorefrontCart(cart, lines, subtotal);
}

// ─── POST /cart ──────────────────────────────────────────────

export async function createCart(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const expiresAt = new Date(Date.now() + CART_TTL_DAYS * 24 * 60 * 60 * 1000);

  const [cart] = await db
    .insert(carts)
    .values({
      shopId: shop.id,
      token: newToken(),
      currency: shop.currency,
      expiresAt,
    })
    .returning();

  return c.json({ cart: await buildCartDto(shop, cart!) }, 201);
}

// ─── GET /cart/:token ────────────────────────────────────────

export async function getCart(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const token = c.req.param('token');
  const cart = await loadCart(shop.id, token);
  if (!cart) return c.json({ error: 'cart_not_found' }, 404);
  return c.json({ cart: await buildCartDto(shop, cart) });
}

// ─── POST /cart/:token/items ─────────────────────────────────

const AddItemSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(999).optional().default(1),
});

export async function addCartItem(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const token = c.req.param('token');
  const cart = await loadCart(shop.id, token);
  if (!cart) return c.json({ error: 'cart_not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = AddItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { variantId, quantity } = parsed.data;

  // Variant moet bestaan, actief zijn, en tot een gepubliceerd product in
  // DEZE shop horen (geen cross-shop / niet-gepubliceerd toevoegen).
  const [variantRow] = await db
    .select({
      id: variants.id,
      price: variants.price,
      active: variants.active,
      productId: variants.productId,
    })
    .from(variants)
    .where(eq(variants.id, variantId))
    .limit(1);
  if (!variantRow || !variantRow.active) {
    return c.json({ error: 'variant_not_found' }, 404);
  }

  const pub = await isVariantPublishedInShop(shop.id, variantRow.productId);
  if (!pub.published) {
    return c.json({ error: 'variant_not_available_in_shop' }, 404);
  }

  // Voorraad-check: bestaande qty in cart + nieuwe qty mag available niet
  // overschrijden.
  const [existing] = await db
    .select({ id: cartItems.id, quantity: cartItems.quantity })
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, variantId)))
    .limit(1);

  const availMap = await availableByVariant([variantId]);
  const available = availMap.get(variantId) ?? 0;
  const desiredQty = (existing?.quantity ?? 0) + quantity;
  if (desiredQty > available) {
    return c.json(
      {
        error: 'insufficient_stock',
        available,
        requested: desiredQty,
      },
      422,
    );
  }

  const unitPrice = effectivePrice(variantRow, pub.priceOverride);

  if (existing) {
    await db
      .update(cartItems)
      .set({ quantity: desiredQty, unitPrice })
      .where(eq(cartItems.id, existing.id));
  } else {
    await db.insert(cartItems).values({
      cartId: cart.id,
      variantId,
      quantity: desiredQty,
      unitPrice,
    });
  }
  await touchCart(cart.id);

  return c.json({ cart: await buildCartDto(shop, cart) }, existing ? 200 : 201);
}

// ─── PATCH /cart/:token/items/:itemId ────────────────────────

const PatchItemSchema = z.object({
  quantity: z.coerce.number().int().min(0).max(999),
});

export async function updateCartItem(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const token = c.req.param('token');
  const itemId = c.req.param('itemId');
  if (!isUuid(itemId)) return c.json({ error: 'invalid_item_id' }, 400);

  const cart = await loadCart(shop.id, token);
  if (!cart) return c.json({ error: 'cart_not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = PatchItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { quantity } = parsed.data;

  const [item] = await db
    .select({ id: cartItems.id, variantId: cartItems.variantId })
    .from(cartItems)
    .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id)))
    .limit(1);
  if (!item) return c.json({ error: 'cart_item_not_found' }, 404);

  if (quantity === 0) {
    await db.delete(cartItems).where(eq(cartItems.id, item.id));
    await touchCart(cart.id);
    return c.json({ cart: await buildCartDto(shop, cart) });
  }

  const availMap = await availableByVariant([item.variantId]);
  const available = availMap.get(item.variantId) ?? 0;
  if (quantity > available) {
    return c.json({ error: 'insufficient_stock', available, requested: quantity }, 422);
  }

  await db.update(cartItems).set({ quantity }).where(eq(cartItems.id, item.id));
  await touchCart(cart.id);
  return c.json({ cart: await buildCartDto(shop, cart) });
}

// ─── DELETE /cart/:token/items/:itemId ───────────────────────

export async function removeCartItem(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const token = c.req.param('token');
  const itemId = c.req.param('itemId');
  if (!isUuid(itemId)) return c.json({ error: 'invalid_item_id' }, 400);

  const cart = await loadCart(shop.id, token);
  if (!cart) return c.json({ error: 'cart_not_found' }, 404);

  const [item] = await db
    .select({ id: cartItems.id })
    .from(cartItems)
    .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id)))
    .limit(1);
  if (!item) return c.json({ error: 'cart_item_not_found' }, 404);

  await db.delete(cartItems).where(eq(cartItems.id, item.id));
  await touchCart(cart.id);
  return c.json({ cart: await buildCartDto(shop, cart) });
}

// ─── DELETE /cart/:token/items (clear) ───────────────────────

export async function clearCart(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const token = c.req.param('token');
  const cart = await loadCart(shop.id, token);
  if (!cart) return c.json({ error: 'cart_not_found' }, 404);

  await db.delete(cartItems).where(eq(cartItems.cartId, cart.id));
  await touchCart(cart.id);
  return c.json({ cart: await buildCartDto(shop, cart) });
}

// ─── helpers ─────────────────────────────────────────────────

async function touchCart(cartId: string): Promise<void> {
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

/**
 * Is dit product gepubliceerd in deze shop? Geeft tevens de price_override
 * (voor unit-price snapshot).
 */
export async function isVariantPublishedInShop(
  shopId: string,
  productId: string,
): Promise<{ published: boolean; priceOverride: string | null }> {
  const [row] = await db
    .select({
      published: shopProducts.published,
      priceOverride: shopProducts.priceOverride,
    })
    .from(shopProducts)
    .where(and(eq(shopProducts.shopId, shopId), eq(shopProducts.productId, productId)))
    .limit(1);
  if (!row || !row.published) return { published: false, priceOverride: null };
  return { published: true, priceOverride: row.priceOverride };
}

// re-export voor checkout
export { loadCart, buildCartDto };
