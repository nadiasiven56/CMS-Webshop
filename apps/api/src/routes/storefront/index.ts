/**
 * Storefront-router — `/api/storefront/v1/*` (PUBLIEK).
 *
 * Dit is de publieke API waar de webshops (Wave 3) op draaien. GEEN
 * `requireAuth` — wel verplichte shop-scoping via `shopScope`-middleware
 * (`?shop=<slug>` of header `X-Shop-Slug` / `X-Shop-Domain`).
 *
 * Endpoints (alle relatief aan /api/storefront/v1):
 *   GET    /health                     — connectivity-check (shop optioneel)
 *   GET    /shop                       — huidige shop (publiek subset)
 *   GET    /products                   — catalogus (published shop_products)
 *   GET    /products/:slug             — product-detail (variants + images)
 *   GET    /pages/:slug                — CMS-pagina (published) + globale blocks
 *   GET    /menus                      — navigatie-menus (genest)
 *   GET    /blog                       — blog-lijst (published)
 *   GET    /blog/:slug                 — blog-detail (published)
 *   POST   /cart                       — maak cart
 *   GET    /cart/:token                — cart ophalen
 *   POST   /cart/:token/items          — add item (voorraad-check)
 *   PATCH  /cart/:token/items/:itemId  — qty wijzigen (0 = verwijderen)
 *   DELETE /cart/:token/items/:itemId  — regel verwijderen
 *   DELETE /cart/:token/items          — cart legen
 *   POST   /cart/:token/checkout       — order plaatsen (payment mock = paid)
 *
 * Wired in routes/index.ts door Atlas (zie REGISTER.md).
 */
import { Hono } from 'hono';
import { shopScope, type StorefrontVariables } from './_shop.js';
import { toStorefrontShop } from './_serialize.js';
import { listCatalog, getCatalogProduct } from './catalog.js';
import { getPage, listMenus, listBlog, getBlogPost } from './content.js';
import {
  createCart,
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
} from './cart.js';
import { checkout } from './checkout.js';
import { storefrontHealth } from './health.js';
import type { Shop } from '../../db/schema/index.js';

export const storefrontRoutes = new Hono<{ Variables: StorefrontVariables }>();

// ── Health ── (VÓÓR shopScope: werkt met én zonder shop-identifier)
storefrontRoutes.get('/health', storefrontHealth);

// Shop-scoping op ALLES — geen requireAuth (publieke API).
storefrontRoutes.use('*', shopScope);

// ── Shop ──
storefrontRoutes.get('/shop', (c) =>
  c.json({ shop: toStorefrontShop(c.get('shop') as Shop) }),
);

// ── Catalog ──
storefrontRoutes.get('/products', listCatalog);
storefrontRoutes.get('/products/:slug', getCatalogProduct);

// ── Content ──
storefrontRoutes.get('/pages/:slug', getPage);
storefrontRoutes.get('/menus', listMenus);
storefrontRoutes.get('/blog', listBlog);
storefrontRoutes.get('/blog/:slug', getBlogPost);

// ── Cart ──
storefrontRoutes.post('/cart', createCart);
storefrontRoutes.get('/cart/:token', getCart);
storefrontRoutes.post('/cart/:token/items', addCartItem);
storefrontRoutes.patch('/cart/:token/items/:itemId', updateCartItem);
storefrontRoutes.delete('/cart/:token/items/:itemId', removeCartItem);
storefrontRoutes.delete('/cart/:token/items', clearCart);

// ── Checkout ──
storefrontRoutes.post('/cart/:token/checkout', checkout);
