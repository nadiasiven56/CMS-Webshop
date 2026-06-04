# Koppelen via de officiële weg

> Operator-handleiding — hoe je elk verkoopkanaal en betaalprovider via de
> **officiële route** koppelt aan je Webshop-CRM. Per integratie: wat het is, hoe
> je bij de echte sleutels komt, exact welk veld je waar in de admin plakt, en het
> verschil tussen test/sandbox en productie.
>
> Context: dit beschrijft de "koppel-klaar"-insteekpunten uit
> [`MULTICHANNEL-COMMAND-CENTER.md`](../MULTICHANNEL-COMMAND-CENTER.md). De backend
> implementeert de **officiële API's** (Bol Retailer v10, Amazon SP-API, Mollie
> Payments v2, publishable storefront-token). Inpluggen is een **config-actie**:
> sleutels plakken, "Test verbinding", klaar — geen code-wijziging.

**Login admin:** `admin@webshop-crm.local` / `admin12345` → kies winkel op `/launch` → admin-shell.

**Algemene principes**
- Alle geheime sleutels worden **versleuteld** opgeslagen (AES-256-GCM, `CHANNEL_SECRET_KEY`). Ze komen **nooit** raw terug — de admin toont alleen of een veld "gezet" is.
- Marketplace-kanalen (Bol/Amazon) staan **default in test/demo** tot je expliciet op productie zet. Je kunt niets per ongeluk live verkopen.
- Workflow is overal hetzelfde: **velden invullen → Test verbinding → (bij groen) Sync nu**.

---

## 1. Eigen / externe webshop — publishable storefront-token

**Wat het is.** Een **niet-geheim, scoped token** (model: Shopify
`X-Shopify-Storefront-Access-Token` / Medusa `x-publishable-api-key`) waarmee je
externe, statische webshop zich bij élke storefront-call identificeert. Het is
"publishable" — bedoeld om in client-side browser-code te staan — maar
identificeert deterministisch één shop en is intrekbaar/roteerbaar. De SDK stuurt
het mee als header `X-Storefront-Token`.

**Token-format:** `wcrm_pk_<base64url(32 random bytes)>` (256 bits entropie).
De backend bewaart alleen de **sha256-hash** (`shops.storefront_token_hash`); de
raw waarde wordt **precies één keer** getoond bij genereren/roteren.

**Officiële stappen (in deze admin — er is geen externe provider nodig):**
1. Admin → **Shops** → klik je winkel → sectie **"Koppel je webshop"**.
2. Klik **Genereer storefront-token** → kopieer de `wcrm_pk_...` waarde **direct**
   (hij wordt maar 1× getoond; kwijt = opnieuw genereren/roteren).
3. Kopieer ook de **API-base** (`https://<crm-host>/api/storefront/v1`) en de
   **Shop-slug** uit hetzelfde paneel.
4. Zet je externe webshop-domein in **Toegestane origins (CORS)** (komma-gescheiden).

**Wat plak je waar (op de externe statische webshop):** plak het
insluit-snippet uit het paneel en vul de gekopieerde waarden in:
```html
<script type="module">
  import './webshop-crm-sdk.js';
  WebshopCRM.init({
    apiBase: 'https://<crm-host>/api/storefront/v1',  // ← API-base uit het paneel
    shopSlug: '<jouw-slug>',                            // ← Shop-slug uit het paneel
    token: 'wcrm_pk_...'                                // ← publishable token (1× getoond)
  });
</script>
```
De SDK stuurt het token bij elke call mee als `X-Storefront-Token` en draait
products / menu's / winkelmandje / checkout tegen deze CRM.

**Test vs productie.** Eén token werkt voor beide; de scheiding is je shop-`status`
(`active` vs `draft`). Gebruik **Test verbinding** in het paneel
(`GET /api/storefront/v1/health?shop=<slug>`) om te bevestigen dat de shop wordt
herkend. Bij een lek of vermoeden van misbruik: **roteer** het token (oude wordt
direct ongeldig). Veilig in de browser: het token is read/cart-scoped, geen admin-rechten.

> Let op: `webshop-crm-sdk.js` / `example.html` moet via `http(s)` geserveerd
> worden — ES-module-import werkt niet vanaf `file://`.

---

## 2. Bol.com — Retailer API v10

**Wat het is.** Officiële marketplace-koppeling via de **Bol Retailer API v10**.
Auth = OAuth2 **client-credentials** tegen `https://login.bol.com/token`; de
resource-calls gebruiken de v10 media-type (`application/vnd.retailer.v10+json`).
Demo-host = `https://api.bol.com/retailer-demo`, productie =
`https://api.bol.com/retailer`.

**Officiële stappen om de sleutels te krijgen:**
1. Log in op het **bol.com partnerplatform** → <https://partnerplatform.bol.com>.
2. Ga naar **Instellingen** → **API** (zichtbaar voor het **technisch contact** van
   het account; stel jezelf zo nodig in als technisch contact).
3. Onder **"Client credentials voor de Retailer API"** → klik **Aanmaken**.
4. Je krijgt een **Client ID** + een **secret** — klik **Toon secret** en kopieer
   beide direct (het secret is daarna niet opnieuw op te halen).

**Wat plak je waar (admin):** Admin → **Kanalen** → kanaal **Bol** → **Configureren**:

| Veld in admin | Plak hier | Officiële bron |
|---|---|---|
| **Client-ID** | je Bol Client ID | partnerplatform → API |
| **Client-secret** | je Bol secret (versleuteld opgeslagen) | partnerplatform → API ("Toon secret") |
| **Environment** | `demo` of `production` (`config.environment`, default `demo`) | jouw keuze |

Daarna: **Test verbinding** (bij succes: *"Bol Retailer API v10 (demo) verbonden"*)
→ status wordt `connected` → **Sync nu**.

**Sandbox/test vs productie.** Een vers kanaal staat **default op `demo`** →
`api.bol.com/retailer-demo`: er gaat **niets live**, ideaal om de koppeling en sync
te testen. Zet **Environment** pas op `production` als je écht wilt verkopen; dan
gaat dezelfde flow naar `api.bol.com/retailer`. De client cachet het OAuth-token,
respecteert `Retry-After` bij rate-limits (429) en poll't Bol's async
`ProcessStatus` voor schrijf-acties — dat hoef je zelf niet te regelen.

---

## 3. Amazon — Selling Partner API (SP-API)

**Wat het is.** Officiële marketplace-koppeling via de **Amazon SP-API**, auth-model
**LWA-only** (Login with Amazon refresh-token; **geen** AWS SigV4 meer nodig). De
access-token gaat als header `x-amz-access-token` (níét `Authorization: Bearer`).
Regionale host wordt gekozen op **region** (`eu`/`na`/`fe`) + een
**sandbox/production**-toggle. Buyer-PII (adressen/namen) en notifications worden
door de adapter afgehandeld via een Restricted Data Token (RDT) — daar heb jij geen
omkijken naar.

**Officiële stappen om de sleutels te krijgen:**
1. Je hebt een **Professional seller**-account nodig en moet de **primary user**
   (account-eigenaar) zijn.
2. Seller Central → **Apps & Services** → **Develop Apps**.
3. Registreer je als **Private Developer** (eenmalig developer-profiel).
4. **Add new app client** — kies de rollen **Orders** + **Inventory** /
   **Pricing** (de rollen die deze CRM gebruikt).
5. Je krijgt een **LWA `client_id`** en **`client_secret`** (de "App credentials").
6. Klik **"Authorize app"** (self-authorization op je eigen seller-account) →
   hieruit rolt een **`refresh_token`**. Dit refresh-token is de langlevende
   sleutel die de CRM gebruikt.

**Wat plak je waar (admin):** Admin → **Kanalen** → kanaal **Amazon** → **Configureren**:

| Veld in admin | Backend-credentialnaam | Plak hier |
|---|---|---|
| **Client-ID** | `lwaClientId` (alias `clientId`) | LWA `client_id` |
| **Client-secret** | `lwaClientSecret` (alias `clientSecret`) | LWA `client_secret` (versleuteld) |
| **Refresh-token (SP-API)** | `refreshToken` | het `refresh_token` uit "Authorize app" |
| **Seller-ID** | `sellerId` | je merchant/seller-id (optioneel, nodig voor listings-pad) |
| **Marketplace-ID** | `marketplaceIds` (alias `marketplaceId`) | bv. **`A1805IZSGTT6HS`** (Amazon.nl) |
| **Region** | `region` | `eu` (NL/DE/FR/BE), `na` of `fe` — default `eu` |
| **Environment** | `environment` | `sandbox` of `production` — default `production` |

Marketplace-id's (regio EU): NL `A1805IZSGTT6HS` · DE `A1PA6795UKMFR9` ·
FR `A13V1IB3VIYZZH` · BE `AMEN7PMS3EDWL` · IT `APJ6JRA9NG5V4` ·
ES `A1RKKUPIHCS9HS` · GB `A1F83G8C2ARO7P`.

Daarna: **Test verbinding** → status `connected` → **Sync nu**. `region` en
`environment` mogen ook via de kanaal-config; config wint van een credential-default.

**Sandbox vs productie.** Zet **Environment** op `sandbox` om tegen de SP-API
sandbox-host (`https://sandbox.sellingpartnerapi-<region>.amazon.com`) te testen
zonder echte orders/listings te raken. `production` praat met
`https://sellingpartnerapi-<region>.amazon.com`. De client doet LWA-token-caching
(1u), per-operatie rate-limiting (token-bucket) en 429/5xx-backoff automatisch.

---

## 4. Betalingen — Mollie (Payments API v2)

**Wat het is.** Officiële betaalprovider-koppeling via de **Mollie Payments API v2**
(per shop). Auth = `Authorization: Bearer <key>` tegen `https://api.mollie.com`. De
**key-prefix bepaalt de modus** — `test_...` = testmodus, `live_...` = livemodus —
tegen **dezelfde host** (Mollie heeft geen aparte sandbox-host). De adapter
implementeert create-payment, status-poll, refund + webhook, allemaal idempotent.

**Officiële stappen om de sleutels te krijgen:**
1. Maak / log in op een account op <https://www.mollie.com> → dashboard
   **<https://my.mollie.com>**.
2. Ga naar **Developers** → **API keys**.
3. De **`test_...` key** is **meteen** beschikbaar — gebruik die om checkout end-to-end
   te testen.
4. De **`live_...` key** wordt pas actief **nadat je organisatie geverifieerd is**
   (KYC: bedrijfsgegevens, **UBO**-verificatie, bankrekening). Doorloop die
   onboarding in het Mollie-dashboard.

**Wat plak je waar (admin):** Admin → **Shops** → klik je winkel → tab/sectie
**Betalingen**:

| Veld in admin | Backend-veld | Plak hier |
|---|---|---|
| **Provider** | `payment_provider` | kies **Mollie** |
| **API key** | `payment_credentials.apiKey` (versleuteld) | je `test_...` of `live_...` key |

**Test vs productie.** Je hoeft niets aan een "omgeving"-schakelaar te doen — de
**key-prefix kiest de modus**: plak `test_...` voor testbetalingen, `live_...` voor
echte. **Zonder ingestelde key blijft checkout op het ingebouwde test-betaald-pad**
(mock provider) — er wordt dan niets echt geïnd, maar je orderflow + boekhouding
werken al volledig. Zodra je een key zet, lopen betalingen via Mollie en wordt de
order pas als betaald geboekt na bevestiging via de Mollie-webhook.

---

## Verbindings-checklist (alle kanalen)

1. Sleutels opgehaald bij de officiële bron (zie per sectie).
2. Velden geplakt in **Kanalen → Configureren** (Bol/Amazon) of **Shops → Betalingen** (Mollie) of **Shops → Koppel je webshop** (storefront-token).
3. **Test verbinding** → groen.
4. Marketplace nog op test? → zet **Environment** op `production`/`live` wanneer je live wilt.
5. **Sync nu** → orders importeren + listings pushen.

> Niets gaat live zolang je op `demo`/`sandbox` (Bol/Amazon) of `test_` (Mollie)
> staat, of zolang er geen storefront-token/PSP-key is ingesteld. De koppeling is
> volledig een config-actie — zie ook [`MULTICHANNEL-COMMAND-CENTER.md`](../MULTICHANNEL-COMMAND-CENTER.md).
