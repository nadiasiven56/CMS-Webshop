# Webshop-CRM Storefront SDK

A framework-free, drop-in JavaScript SDK that connects any **static website** to a
Webshop-CRM shop through the public storefront API (`/api/storefront/v1`). No build
step, no dependencies — one file you drop next to your HTML.

This is the path by which an **external webshop (running on another PC)** connects to
your CRM later: the static shop ships the SDK, points `apiBase` at the CRM host, and
all catalog/cart/checkout traffic flows over the public, shop-scoped API.

> **The official way to connect** an external static webshop:
> generate a **publishable storefront token** in the admin (open a shop → *Koppel je
> webshop* → **Storefront-token** → *Genereer token*) and paste it — together with your
> `apiBase` — into the `init(...)` snippet below. The SDK then sends it as the
> `X-Storefront-Token` header on every request. This token is a **public, scope-limited**
> key (à la Shopify `X-Shopify-Storefront-Access-Token` / Medusa `x-publishable-api-key`):
> it is safe to ship in browser code and is **distinct from your admin login**. It can be
> rotated or revoked at any time from the same panel. The `shopSlug` still works as a
> back-compat fallback.

Files in this folder:

| File                   | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `webshop-crm-sdk.js`   | The SDK. ES-module **and** browser-global (`window.WebshopCRM`). |
| `example.html`         | Copy-paste reference: product grid + live cart + checkout form. |
| `README.md`            | This file.                                                      |

---

## 1. Drop it in

**Option A — ES module (recommended):**

```html
<script type="module">
  import { init } from './webshop-crm-sdk.js';

  const shop = init({
    apiBase: 'http://127.0.0.1:7300/api/storefront/v1',   // your CRM host
    storefrontToken: 'wcrm_pk_…',                         // OFFICIAL: paste from admin
    shopSlug: 'crema',                                    // optional back-compat fallback
  });
</script>
```

**Option B — classic global (no module system):**

```html
<script src="./webshop-crm-sdk.js"></script>
<script>
  const shop = WebshopCRM.init({
    apiBase: 'http://127.0.0.1:7300/api/storefront/v1',
    storefrontToken: 'wcrm_pk_…',   // OFFICIAL: paste from admin
    shopSlug: 'crema',              // optional back-compat fallback
  });
</script>
```

> You may pass **either** `storefrontToken` (the official way) **or** `shopSlug` (back-compat)
> — at least one is required. Passing both is fine: the SDK sends the token as
> `X-Storefront-Token` and the slug as `X-Shop-Slug`, and the API prefers the token.

> The file is a UMD-ish wrapper, so it also works under CommonJS (`require`) and AMD.

---

## 2. API

```js
const shop = WebshopCRM.init({ apiBase, storefrontToken /* official */, shopSlug /* fallback */ });

// Shop
await shop.shop.get();                       // { id, slug, name, currency, branding, ... }

// Catalog
await shop.products.list({ q, tag, sort, page, perPage }); // { items, total, limit, offset }
await shop.products.get(slug);               // detail with .variants[] (use variant.id to add)

// Cart  (auto-creates a server cart on first add; token persisted in localStorage)
await shop.cart.get();                       // current cart (or empty cart shape)
await shop.cart.add(variantId, qty);         // qty defaults to 1
await shop.cart.update(itemId, qty);         // qty 0 removes the line
await shop.cart.remove(itemId);
await shop.cart.clear();
shop.cart.token();                           // current server token, or null

// Checkout  → { order: { orderNumber, grandTotal, financialStatus, ... }, payment: {...} }
await shop.checkout({
  email: 'klant@example.com',
  firstName: 'An', lastName: 'Klant', phone: '0612345678', // all optional
  shippingAddress: { line1: 'Teststraat 1', postcode: '1234 AB', city: 'Amsterdam', country: 'NL' },
  billingAddress: { ... },   // optional; defaults to shippingAddress
  shippingTotal: '4.95',     // optional decimal STRING; defaults to '0'
});

// Content (optional helpers)
await shop.content.page(slug);
await shop.content.menus();
await shop.content.blog({ tag, limit, offset });
await shop.health();
```

### `products.list` param mapping

The ergonomic params map onto the API's query params for you:

| SDK param  | API query | Notes                                                                   |
| ---------- | --------- | ----------------------------------------------------------------------- |
| `q`        | `search`  | title search                                                            |
| `tag`      | `tag`     | exact tag match                                                         |
| `sort`     | `sort`    | `position` \| `newest` \| `price_asc` \| `price_desc` \| `title`         |
| `page`     | `offset`  | 1-based; `offset = (page - 1) * perPage`                                |
| `perPage`  | `limit`   | default `24` (max 100)                                                  |

You can still pass raw `search` / `limit` / `offset` if you prefer.

---

## 3. Behaviour you can rely on

- **Shop scoping.** The official way: every request sends an `X-Storefront-Token: <token>`
  header (the publishable `wcrm_pk_…` key). For back-compat the SDK also sends
  `X-Shop-Slug: <slug>` whenever a slug is configured; the API additionally accepts
  `?shop=<slug>` / `?storefront_token=<token>` and `X-Shop-Domain`. When both a token and a
  slug are present, the API resolves the shop by **token first**, then falls back to slug.
- **Cart persistence.** The server cart **token** is stored in `localStorage` under
  `wcrm_cart_token_<scope>` (scope = the `shopSlug` when set, otherwise a short non-secret
  suffix derived from the storefront token) and re-attached on the next page load. A new cart is created
  automatically on the first `add`. If a stored token has expired (server returns 404),
  the SDK transparently creates a fresh cart and retries the add once. After a successful
  `checkout` the token is forgotten so the next visit starts clean.
- **Live cart event.** After **any** cart mutation (`add` / `update` / `remove` / `clear`
  / `checkout`) the SDK dispatches a DOM `CustomEvent` named **`wcrm:cart-updated`** on
  `window`, with `event.detail` set to the new cart. Wire your badge/drawer to it:

  ```js
  window.addEventListener('wcrm:cart-updated', (e) => renderCart(e.detail));
  // event name is also exported: import { CART_EVENT } from './webshop-crm-sdk.js';
  ```

- **Money stays a string.** All amounts (`price`, `subtotal`, `lineTotal`, `grandTotal`,
  `shippingTotal`) are decimal **strings**, exactly as the API returns them. Convert to a
  number only for display (`Intl.NumberFormat`), never carry float math back into requests.
- **Typed errors.** Any non-2xx response throws an object
  `{ status, code, message }` (also a real `Error`, with an optional `.details` from the
  API's validation output). The JSON error body (`{ error, message }`) is parsed when
  present; otherwise `code` falls back to `http_<status>` / `network_error`.

  ```js
  try {
    await shop.cart.add(variantId, 99);
  } catch (err) {
    // err.status, err.code (e.g. 'insufficient_stock'), err.message
  }
  ```

---

## 4. Connecting an external shop the official way

1. In the admin, open the shop → **Koppel je webshop** → **Storefront-token** →
   **Genereer token**. The raw `wcrm_pk_…` token is shown **once** — copy it now (you can
   always rotate to get a fresh one; rotating invalidates the previous token).
2. Paste it (plus your `apiBase`) into the `init({ apiBase, storefrontToken })` snippet —
   the same panel shows a ready-to-copy snippet prefilled for that shop.
3. Deploy your static shop anywhere. The SDK sends `X-Storefront-Token` on every request,
   which deterministically identifies the shop — no slug guessing.

The token is **publishable**: it is meant to live in client-side code, is scope-limited to
the public storefront API, and is **not** your admin login. Revoke or rotate it from the
same panel at any time.

### CORS / allowed origins

The storefront API already reflects **any** origin for `/api/storefront/*`, so a static
shop served from any domain (or `file://` during local testing) can call it directly in
the browser — no proxy required. When you move the shop to its own host/PC, you only
change `apiBase` to point at the CRM machine (e.g. `http://192.168.1.x:7300/api/storefront/v1`
or a public HTTPS URL behind a reverse proxy).

If you later lock CORS down to specific origins, add the shop's public origin to the
allow-list on the API side (the **Toegestane origins** field in the same admin panel);
nothing in the SDK changes.

---

## 5. Try it

1. Make sure the API is running on `:7300` (it is, in this environment).
2. Open `example.html` in a browser. Either:
   - **official:** generate a token in the admin and append `?token=wcrm_pk_…` to the URL
     (or paste it into the token field on the page and hit *Verbinden*), **or**
   - **fallback:** append `?shop=crema` (or `pawfect` / `smoke`) to switch shops by slug.
3. Add a product, watch the cart total update live, fill the form, and check out —
   the resulting **order number** is shown on success.

> `example.html` imports the SDK as an ES module via a relative path, so serve it over
> `http(s)://` (e.g. `npx serve`, the Vite dev server, or any static host) rather than
> opening straight from `file://` if your browser blocks module imports from `file://`.
