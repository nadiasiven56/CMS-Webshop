# Review-bevindingen & verbeteringen (2026-06-05)

Resultaat van een volledige multi-agent code-review (10 dimensies + adversariële
verificatie van elke bug/security-claim) op webshop-crm, gevolgd door een
verbeterronde. De adversariële verificatie heeft niet-reële claims eruit
gefilterd (o.a. "geen tenant-isolatie" → bewust single-operator design per
`docs/VISION.md`; "geen idempotency op checkout" → de globale idempotency-
middleware dekt het al).

Legenda: ✅ = doorgevoerd in deze ronde · 🔜 = bewust uitgesteld (zie reden + prio).

---

## ✅ Doorgevoerd — geld & grootboek (kern-correctheid)

| # | Sev | Wat | Bestand |
|---|-----|-----|---------|
| 1 | **CRIT** | **BTW bruto/netto-mismatch**: storefront-checkout sloeg `subtotal` bruto op terwijl het grootboek het netto leest → omzet werd met de BTW overschat. Nu splitst de checkout per regel in hele centen (`splitVat`) → `subtotal` = netto, `taxTotal` = BTW, `lineTotal` = bruto; net+btw blijft exact gelijk aan het bruto dat de klant betaalt. **Geverifieerd**: ledger gebalanceerd, revenue = netto, smoke PASS. | `routes/storefront/checkout.ts` |
| 2 | HIGH | **Ordernummer-race**: checkout gebruikte `count(*)` (fout na verwijderde order). Nu de domein-helper `nextOrderNumber` (max-suffix+1). | `routes/storefront/checkout.ts` |
| 3 | HIGH | **`PATCH /orders/:id/status` boekte geen grootboek**: → 'paid' boekt nu omzet (idempotent), → 'refunded'/'cancelled' van een geboekte order draait het grootboek terug. | `routes/orders/status.ts` |
| 4 | HIGH | **OSS-export crashte op Q2/Q3** (hardcoded `-31` bestaat niet in juni/sept) → correcte laatste-dag-berekening. | `routes/finance/index.ts` |
| 5 | HIGH | **Voorraad-oversell-race**: voorraadrijen worden nu `SELECT … FOR UPDATE` gelockt in de checkout-tx → gelijktijdige checkouts serialiseren i.p.v. oversellen. | `routes/storefront/checkout.ts` |
| 6 | HIGH | **Mollie-webhook stuurde geen bevestiging**: vuurt nu `order.paid` (transactionele e-mail + webhook) na een echte PSP-betaling. | `routes/payments/mollie-webhook.ts` |
| 7 | HIGH | **Geen over-refund-bescherming**: weigert nu (409) als de cumulatieve terugbetaling het order-totaal overschrijdt (primair return-pad). | `routes/orders/returns.ts` |
| 8 | MED | **Cart-expiry niet afgedwongen**: verlopen carts worden niet meer geladen/afgerekend. | `routes/storefront/cart.ts` |
| 9 | MED | **Channel-sync nulde de CRM-order-link** bij re-sync → `coalesce` behoudt de bestaande koppeling. | `routes/channels/sync.ts` |

## ✅ Doorgevoerd — security & deploy

- Rate-limiting op `/api/auth/login` (+ publieke storefront/payments), uit in NODE_ENV=test.
- Security-headers (Hono `secureHeaders` + Caddy `header`-block: HSTS/nosniff/X-Frame/Referrer-Policy).
- CORS: `credentials:false` voor publieke storefront/feeds (token-based), `true` alleen voor admin-origin.
- Sessie-cookie `Secure` ontkoppeld van NODE_ENV (`COOKIE_SECURE`/PUBLIC_URL-scheme) → :80/tunnel-deploy werkt.
- SSRF-bescherming op uitgaande webhooks (blokkeer loopback/link-local/RFC1918, https-only in prod).
- `GET /health/ready` met DB-ping (503 bij DB-down) naast goedkope `/health` liveness.
- Idempotency-middleware: alleen 2xx cachen + in-flight lock tegen dubbele writes.
- Docker: entrypoint faalt nu op échte seed-fouten; log-rotatie (json-file 10m×5); DATABASE_URL-hardening (hex-wachtwoord-advies).

## ✅ Doorgevoerd — storefront

- SEO: per-pagina title/meta/canonical/OG + JSON-LD (Product/Article) via een head-hook.
- XSS: alle `dangerouslySetInnerHTML` gesanitiseerd (DOMPurify).
- PSP cart-retry: cart blijft staan tot betaling bevestigd → mislukte betaling = terug naar winkelwagen.
- Checkout: kortingscode-veld + volledig kostenoverzicht (subtotaal/korting/verzending/BTW/totaal) + zakelijke velden; betaalknop toont het echte bedrag.
- Order-tracking-pagina (`/volg-bestelling`) op het bestaande status-endpoint.
- A11y/perf: focus-visible, skip-link, land-select, image-dimensies/LCP, `lang` uit shop.locale; conditionele demo-disclaimer + trust-signalen.

## ✅ Doorgevoerd — admin

- A11y: `FormField` label↔input gekoppeld, klikbare rijen toetsenbord-bereikbaar, toast `aria-live`, drawer/modal focus-trap, `aria-current` op nav.
- Error-boundary op de root + mock-fallback alleen bij netwerk/5xx (4xx niet meer stil gemaskeerd).
- Command-palette (Ctrl/⌘K) globale zoek + werkende shortcuts; product-tab-counts + sortering gefixt; raw `<a>` → Router-`Link`.
- Bulk-acties + CSV-export op de orders-lijst.

> De agent-deliverables (security/deploy, storefront, admin) zijn afzonderlijk
> typecheck+build-groen opgeleverd en bij de eindverificatie integraal opnieuw
> gecontroleerd (typecheck · tests · builds · smoke · e2e).

---

## 🔜 Bewust uitgesteld (geprioriteerde backlog)

Reëel bevonden, maar groter/risicovoller dan deze ronde toelaat zonder de groene
build in gevaar te brengen. Geen van deze blokkeert deploy; documentatie zodat
ze niet verloren gaan.

### Finance/grootboek
- **HIGH — Refunds in `source=orders` P&L**: `/finance/pnl` + `ledger/aggregate?source=orders` tellen (deels) gerefunde orders voor het volle bedrag. *Mitigerend*: `source=ledger` verrekent refunds wél correct. Fix: refund-aftrek in de orders-query, of standaard de ledger als bron.
- **HIGH — OSS `vat_country` niet gevuld** door `postOrderRevenue`/`postRefund` → OSS-CSV blijft leeg voor live data. Fix: land doorgeven aan de posting-kern (uit order-adres/shop-default).
- **HIGH — Verzendkosten niet in grootboek**: `trade_debtors` = netto+btw, niet `grandTotal`. Fix: shipping-revenue meeboeken.
- **HIGH — `taxTotal` niet herrekend na korting** (consistent met admin; V1-simplificatie). Fix: korting proportioneel op netto + BTW herrekenen.
- **MED — `postRefund` idempotentie**: geen guard op dubbel-boeken bij replay; per-item refund-quantity niet geclamped vs besteld; over-refund-clamp nog niet op het top-level RMA-board-pad.

### Voorraad
- **HIGH — Committed-voorraad nooit vrijgegeven** bij mislukte/geannuleerde PSP-betaling → "phantom out-of-stock". Vereist het reserverings-model (zie volgende).
- **MED — Reserverings-TTL-model**: gebruik `inventory_reservations` (bestaat, ongebruikt) met expiry i.p.v. `available` direct af te boeken; job geeft verlopen reserveringen vrij. (Grote refactor.)
- **MED — Cart toont gesnapshotte prijs, checkout rekent live prijs** → bij prijswijziging onverwacht bedrag. Fix: snapshot leidend, of 409 prijs-gewijzigd.
- **LOW — Ordernummer-retry**: `max+1` is gefixt; een zeldzame gelijktijdige race geeft nog een 500 (UNIQUE vangt het). Fix: retry-loop of per-shop sequence.

### Overig
- **LOW** — channel-crypto via KDF (scrypt/HKDF) i.p.v. kale SHA-256; ledger `entry_date` in shop-tijdzone i.p.v. UTC-slice; factuur-regelsom valideren vs order-totalen; Bol `unitPrice`-fallback op `commission` weghalen; partial-payment mag een 'paid' niet downgraden.
- **admin** — mobiele off-canvas navigatie (nu horizontale scroll-strip); herbruikbare `ErrorState` met retry.
- **storefront** — echte SSR/prerender voor volledige indexeerbaarheid (nu client-side SPA + head-hook).

### Security (los van app-code)
- **CRIT — `.pgdata` in de publieke git-historie**: de dev-database (incl. seed-admin bcrypt-hash) is meegecommit naar `github.com/nadiasiven56/CMS-Webshop`. Nu uit tracking + in `.gitignore`, maar **de historie bevat het nog**. Aanbevolen: repo privé maken **of** historie scrubben (`git filter-repo`/BFG + force-push), en seed-admin-wachtwoord roteren bij go-live. (Operator-beslissing — buiten code.)
