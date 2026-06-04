/**
 * webshop-crm-sdk.js — drop-in storefront SDK voor de publieke API
 * (`/api/storefront/v1`). Framework-vrij. Werkt zowel als ES-module
 * (`import { init } from './webshop-crm-sdk.js'`) ALS als browser-global
 * (`window.WebshopCRM`) via een UMD-achtige wrapper.
 *
 * Quick start (browser) — de OFFICIËLE headless-connect-weg gebruikt een
 * publishable storefront-token (`wcrm_pk_...`), te genereren in de admin onder
 * "Koppel je webshop":
 *   <script type="module">
 *     import { init } from './webshop-crm-sdk.js';
 *     const shop = init({
 *       apiBase: 'http://127.0.0.1:7300/api/storefront/v1',
 *       storefrontToken: 'wcrm_pk_…',  // officiële weg (X-Storefront-Token)
 *       shopSlug: 'crema',             // optioneel: back-compat fallback
 *     });
 *   </script>
 *
 * Of als klassiek global (geen module):
 *   <script src="./webshop-crm-sdk.js"></script>
 *   <script>const shop = WebshopCRM.init({ apiBase: '...', storefrontToken: 'wcrm_pk_…' });</script>
 *
 * API:
 *   const shop = WebshopCRM.init({ apiBase, storefrontToken?, shopSlug? });
 *   await shop.shop.get();
 *   await shop.products.list({ q, tag, sort, page, perPage });
 *   await shop.products.get(slug);
 *   await shop.cart.get();
 *   await shop.cart.add(variantId, qty);
 *   await shop.cart.update(itemId, qty);
 *   await shop.cart.remove(itemId);
 *   await shop.cart.clear();
 *   await shop.checkout({ email, firstName?, lastName?, phone?, shippingAddress, billingAddress?, shippingTotal? });
 *
 * Belangrijk:
 *   - De OFFICIËLE weg: elke request stuurt `X-Storefront-Token: <token>` mee
 *     (publishable, scope-beperkt — veilig in de browser). Daarnaast gaat
 *     `X-Shop-Slug: <slug>` mee zolang er een slug is (back-compat). Minstens
 *     één van beide is vereist.
 *   - De server-cart-TOKEN wordt bewaard in localStorage onder
 *     `wcrm_cart_token_<scope>` (scope = slug indien aanwezig, anders afgeleid
 *     van het storefront-token) en automatisch her-aangehecht.
 *   - Cart wordt automatisch aangemaakt bij de eerste `add`.
 *   - Na elke cart-mutatie vuurt een DOM CustomEvent `wcrm:cart-updated`
 *     (detail = de nieuwe cart) af op `window`.
 *   - Geld blijft string (decimal). Nooit float-rekenen op bedragen.
 *   - Fouten gooien een object `{ status, code, message }` bij niet-2xx;
 *     het JSON error-body (`{ error, message }`) wordt geparsed indien aanwezig.
 */
(function (root, factory) {
  'use strict';
  // UMD-achtige wrapper: CommonJS, AMD, of browser-global.
  if (typeof module === 'object' && module.exports) {
    // CommonJS / Node (require)
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    // AMD
    define([], factory);
  } else {
    // Browser global (of ES-module-omgeving: dan zetten we op globalThis,
    // waar de ESM named-exports onderaan dit bestand uit lezen).
    root.WebshopCRM = factory();
  }
})(
  (typeof globalThis !== 'undefined' && globalThis) ||
    (typeof self !== 'undefined' && self) ||
    (typeof window !== 'undefined' && window) ||
    this,
  function () {
  'use strict';

  var STORAGE_PREFIX = 'wcrm_cart_token_';
  var CART_EVENT = 'wcrm:cart-updated';
  var DEFAULT_PER_PAGE = 24;

  /**
   * Getypeerde fout. Heeft de vorm { status, code, message } zoals het contract
   * vraagt, en is tevens een echte Error (instanceof Error) voor stack-traces.
   */
  function WcrmError(status, code, message, details) {
    var err = new Error(message || code || 'wcrm_error');
    err.name = 'WcrmError';
    err.status = status;
    err.code = code;
    err.message = message || code || 'wcrm_error';
    if (details !== undefined) err.details = details;
    return err;
  }

  // ── localStorage helpers (no-op buiten de browser) ──────────────────────
  function hasStorage() {
    try {
      return typeof localStorage !== 'undefined' && localStorage !== null;
    } catch (_e) {
      return false;
    }
  }

  function readToken(slug) {
    if (!hasStorage()) return null;
    try {
      return localStorage.getItem(STORAGE_PREFIX + slug);
    } catch (_e) {
      return null;
    }
  }

  function writeToken(slug, token) {
    if (!hasStorage()) return;
    try {
      if (token) localStorage.setItem(STORAGE_PREFIX + slug, token);
      else localStorage.removeItem(STORAGE_PREFIX + slug);
    } catch (_e) {
      /* private mode / quota — stilletjes negeren */
    }
  }

  // ── DOM-event helper (no-op buiten de browser) ──────────────────────────
  function emitCartUpdated(cart) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    var evt;
    try {
      evt = new CustomEvent(CART_EVENT, { detail: cart });
    } catch (_e) {
      // Oudere browsers: fallback op de classic API.
      if (typeof document !== 'undefined' && document.createEvent) {
        evt = document.createEvent('CustomEvent');
        evt.initCustomEvent(CART_EVENT, false, false, cart);
      } else {
        return;
      }
    }
    window.dispatchEvent(evt);
  }

  // ── core request ────────────────────────────────────────────────────────
  function makeClient(opts) {
    if (!opts || !opts.apiBase) {
      throw WcrmError(0, 'config_error', 'init() vereist { apiBase }.');
    }
    // Officiële weg = storefrontToken (publishable, X-Storefront-Token). De
    // shopSlug blijft toegestaan als back-compat fallback. Minstens één van
    // beide MOET er zijn — anders kan de server geen shop resolven.
    if (!opts.storefrontToken && !opts.shopSlug) {
      throw WcrmError(
        0,
        'config_error',
        'init() vereist { storefrontToken } (officiële weg) of { shopSlug } (back-compat).',
      );
    }

    // Strip trailing slash van apiBase zodat path-concat altijd klopt.
    var apiBase = String(opts.apiBase).replace(/\/+$/, '');
    var storefrontToken = opts.storefrontToken ? String(opts.storefrontToken) : null;
    var shopSlug = opts.shopSlug ? String(opts.shopSlug) : null;

    // Scope-sleutel voor de cart-token in localStorage. Slug heeft voorrang
    // (leesbaar + stabiel); zonder slug leiden we een korte, niet-geheime
    // sleutel af van het storefront-token (laatste 12 tekens, géén raw token).
    var cartScope = shopSlug || (storefrontToken ? 'pk_' + storefrontToken.slice(-12) : 'default');

    var fetchImpl =
      opts.fetch ||
      (typeof fetch !== 'undefined' ? fetch.bind(typeof self !== 'undefined' ? self : undefined) : null);

    if (typeof fetchImpl !== 'function') {
      throw WcrmError(
        0,
        'no_fetch',
        'Geen fetch-implementatie gevonden. Geef opts.fetch mee in omgevingen zonder global fetch.',
      );
    }

    /**
     * Voer een request uit tegen de storefront-API.
     * @param {string} path  bv. '/products'
     * @param {object} [cfg] { method, body, query, signal }
     */
    function request(path, cfg) {
      cfg = cfg || {};
      var method = cfg.method || 'GET';

      var url = apiBase + path;
      // Query-string opbouwen (waarden undefined/null/'' worden overgeslagen).
      if (cfg.query) {
        var parts = [];
        for (var k in cfg.query) {
          if (!Object.prototype.hasOwnProperty.call(cfg.query, k)) continue;
          var v = cfg.query[k];
          if (v === undefined || v === null || v === '') continue;
          parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
        }
        if (parts.length) url += (url.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
      }

      var headers = {
        Accept: 'application/json',
      };
      // Officiële weg: publishable token. Slug gaat (ook) mee als back-compat.
      if (storefrontToken) headers['X-Storefront-Token'] = storefrontToken;
      if (shopSlug) headers['X-Shop-Slug'] = shopSlug;
      var hasBody = cfg.body !== undefined;
      if (hasBody) headers['Content-Type'] = 'application/json';

      return fetchImpl(url, {
        method: method,
        headers: headers,
        body: hasBody ? JSON.stringify(cfg.body) : undefined,
        signal: cfg.signal,
      }).then(
        function (res) {
          var contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
          var isJson = contentType.indexOf('application/json') !== -1;

          if (res.status === 204) {
            if (!res.ok) throw WcrmError(res.status, 'http_' + res.status, 'HTTP ' + res.status);
            return null;
          }

          // Parse-stap als Promise zodat we body altijd consumeren.
          var bodyPromise = isJson
            ? res.json().catch(function () {
                return null;
              })
            : res.text().then(
                function () {
                  return null;
                },
                function () {
                  return null;
                },
              );

          return bodyPromise.then(function (payload) {
            if (!res.ok) {
              var code =
                (isJson && payload && payload.error) || 'http_' + res.status;
              var message =
                (isJson && payload && payload.message) || code;
              var details = isJson && payload ? payload.details : undefined;
              throw WcrmError(res.status, code, message, details);
            }
            if (!isJson) {
              throw WcrmError(
                res.status,
                'non_json_response',
                'Onverwachte niet-JSON respons (verkeerd pad of CORS?).',
              );
            }
            return payload;
          });
        },
        function (err) {
          if (err && err.name === 'AbortError') throw err;
          // Al een WcrmError? doorgooien.
          if (err && err.code && typeof err.status === 'number') throw err;
          throw WcrmError(0, 'network_error', String((err && err.message) || err));
        },
      );
    }

    // ── cart-token-state ────────────────────────────────────────────────
    var cartToken = readToken(cartScope);

    function setCartToken(token) {
      cartToken = token || null;
      writeToken(cartScope, cartToken);
    }

    /**
     * Verwerk een cart-respons: persisteer de token, vuur het event af,
     * en geef de cart terug.
     */
    function commitCart(payload) {
      var cart = (payload && payload.cart) || payload;
      if (cart && cart.token) setCartToken(cart.token);
      emitCartUpdated(cart);
      return cart;
    }

    /** Maak een nieuwe server-cart aan en onthoud de token. */
    function createCart() {
      return request('/cart', { method: 'POST', body: {} }).then(commitCart);
    }

    /**
     * Geef de huidige cart-token, maak er zo nodig een aan. Als de bewaarde
     * token niet (meer) geldig is (404), maken we automatisch een nieuwe aan.
     */
    function ensureCart() {
      if (cartToken) return Promise.resolve(cartToken);
      return createCart().then(function () {
        return cartToken;
      });
    }

    /** GET de cart die bij de bewaarde token hoort (of een lege nieuwe). */
    function getCart() {
      if (!cartToken) {
        // Geen token bekend → lege cart-vorm zonder server-roundtrip.
        return Promise.resolve(emptyCart());
      }
      return request('/cart/' + encodeURIComponent(cartToken)).then(commitCart).catch(
        function (err) {
          // Verlopen/onbekende token → reset en geef lege cart terug.
          if (err && err.status === 404) {
            setCartToken(null);
            return emptyCart();
          }
          throw err;
        },
      );
    }

    function emptyCart() {
      return {
        token: null,
        shopId: null,
        currency: null,
        items: [],
        itemCount: 0,
        subtotal: '0',
        expiresAt: null,
        createdAt: null,
        updatedAt: null,
      };
    }

    /**
     * Add: zorgt voor een cart, voegt het item toe. Als de bewaarde token
     * verlopen is (404), maakt hij éénmalig een verse cart aan en herprobeert.
     */
    function addItem(variantId, qty) {
      var quantity = qty == null ? 1 : Number(qty);
      if (!variantId) {
        return Promise.reject(WcrmError(0, 'invalid_request', 'variantId is verplicht.'));
      }

      function doAdd() {
        return request('/cart/' + encodeURIComponent(cartToken) + '/items', {
          method: 'POST',
          body: { variantId: variantId, quantity: quantity },
        }).then(commitCart);
      }

      return ensureCart()
        .then(doAdd)
        .catch(function (err) {
          if (err && err.status === 404) {
            // token verlopen → nieuwe cart, één herkans.
            setCartToken(null);
            return createCart().then(doAdd);
          }
          throw err;
        });
    }

    function updateItem(itemId, qty) {
      if (!cartToken) return Promise.resolve(emptyCart());
      if (!itemId) {
        return Promise.reject(WcrmError(0, 'invalid_request', 'itemId is verplicht.'));
      }
      return request(
        '/cart/' + encodeURIComponent(cartToken) + '/items/' + encodeURIComponent(itemId),
        { method: 'PATCH', body: { quantity: Number(qty) } },
      ).then(commitCart);
    }

    function removeItem(itemId) {
      if (!cartToken) return Promise.resolve(emptyCart());
      if (!itemId) {
        return Promise.reject(WcrmError(0, 'invalid_request', 'itemId is verplicht.'));
      }
      return request(
        '/cart/' + encodeURIComponent(cartToken) + '/items/' + encodeURIComponent(itemId),
        { method: 'DELETE' },
      ).then(commitCart);
    }

    function clearCart() {
      if (!cartToken) return Promise.resolve(emptyCart());
      return request('/cart/' + encodeURIComponent(cartToken) + '/items', {
        method: 'DELETE',
      }).then(commitCart);
    }

    /**
     * Checkout: plaatst de order voor de huidige cart. Na succes wordt de
     * (nu lege) cart-token vergeten zodat een volgende sessie vers begint, en
     * een leeg-cart-event afgevuurd.
     */
    function checkout(input) {
      if (!cartToken) {
        return Promise.reject(WcrmError(0, 'cart_empty', 'Er is geen actieve winkelwagen.'));
      }
      if (!input || !input.email) {
        return Promise.reject(WcrmError(0, 'invalid_request', 'checkout() vereist een email.'));
      }
      if (!input.shippingAddress) {
        return Promise.reject(
          WcrmError(0, 'invalid_request', 'checkout() vereist een shippingAddress.'),
        );
      }
      var tokenForOrder = cartToken;
      return request('/cart/' + encodeURIComponent(tokenForOrder) + '/checkout', {
        method: 'POST',
        body: input,
      }).then(function (result) {
        // Cart is server-side geleegd; vergeet de token + meld lege cart.
        setCartToken(null);
        emitCartUpdated(emptyCart());
        return result; // { order: {...}, payment: {...} }
      });
    }

    // ── products ────────────────────────────────────────────────────────
    /**
     * list({ q, tag, sort, page, perPage }). Ergonomisch:
     *   q       → search
     *   page    → 1-based; vertaalt naar offset = (page-1) * perPage
     *   perPage → limit (default 24)
     *   sort    → 'position' | 'newest' | 'price_asc' | 'price_desc' | 'title'
     */
    function listProducts(params) {
      params = params || {};
      var perPage = params.perPage != null ? Number(params.perPage) : DEFAULT_PER_PAGE;
      var page = params.page != null ? Math.max(1, Number(params.page)) : 1;
      var offset = params.offset != null ? Number(params.offset) : (page - 1) * perPage;
      return request('/products', {
        query: {
          search: params.q != null ? params.q : params.search,
          tag: params.tag,
          sort: params.sort,
          limit: params.limit != null ? params.limit : perPage,
          offset: offset,
        },
        signal: params.signal,
      });
      // → { items, total, limit, offset }
    }

    function getProduct(slug, signal) {
      if (!slug) return Promise.reject(WcrmError(0, 'invalid_request', 'slug is verplicht.'));
      return request('/products/' + encodeURIComponent(slug), { signal: signal }).then(
        function (r) {
          return r && r.product ? r.product : r;
        },
      );
    }

    // ── shop / content ────────────────────────────────────────────────────
    function getShop(signal) {
      return request('/shop', { signal: signal }).then(function (r) {
        return r && r.shop ? r.shop : r;
      });
    }

    function getPage(slug, signal) {
      return request('/pages/' + encodeURIComponent(slug), { signal: signal });
    }

    function listMenus(signal) {
      return request('/menus', { signal: signal }).then(function (r) {
        return r && r.menus ? r.menus : r;
      });
    }

    function listBlog(params) {
      params = params || {};
      return request('/blog', {
        query: { limit: params.limit, offset: params.offset, tag: params.tag },
        signal: params.signal,
      });
    }

    function health(signal) {
      return request('/health', { signal: signal });
    }

    // ── publieke shop-instance ────────────────────────────────────────────
    return {
      apiBase: apiBase,
      shopSlug: shopSlug,
      storefrontToken: storefrontToken,

      shop: { get: getShop },

      products: {
        list: listProducts,
        get: getProduct,
      },

      content: {
        page: getPage,
        menus: listMenus,
        blog: listBlog,
      },

      cart: {
        get: getCart,
        create: createCart,
        add: addItem,
        update: updateItem,
        remove: removeItem,
        clear: clearCart,
        token: function () {
          return cartToken;
        },
        reset: function () {
          setCartToken(null);
        },
      },

      checkout: checkout,
      health: health,

      // Laag-niveau ontsnappingsluik voor endpoints die (nog) geen helper hebben.
      request: request,
    };
  }

  // ── module-namespace ──────────────────────────────────────────────────
  var WebshopCRM = {
    /** Maak een shop-client. Zie file-header voor de volledige API. */
    init: makeClient,
    /** De fout-constructor — handig voor `instanceof`-achtige checks op `.name`. */
    WcrmError: WcrmError,
    /** Naam van het DOM-event dat na cart-mutaties afgevuurd wordt. */
    CART_EVENT: CART_EVENT,
    version: '1.1.0',
  };

  return WebshopCRM;
});

// ── ES-module named exports ───────────────────────────────────────────────
// De UMD-wrapper hierboven dekt CommonJS/AMD/global. Voor `import { init }`
// in echte ES-module-omgevingen (browser <script type=module> / Node ESM)
// re-exporteren we vanaf de global die de factory zojuist heeft gezet.
// Dit blok wordt door CommonJS-`require` genegeerd (het is dode code zodra
// module.exports al gezet is), maar in ESM levert het de named exports.
const __wcrm =
  (typeof self !== 'undefined' && self.WebshopCRM) ||
  (typeof globalThis !== 'undefined' && globalThis.WebshopCRM) ||
  (typeof window !== 'undefined' && window.WebshopCRM) ||
  undefined;

export const init = __wcrm ? __wcrm.init : undefined;
export const WcrmError = __wcrm ? __wcrm.WcrmError : undefined;
export const CART_EVENT = __wcrm ? __wcrm.CART_EVENT : undefined;
export default __wcrm;
