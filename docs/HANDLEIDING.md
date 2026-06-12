# Webshop-CRM — Handleiding (hoe het systeem werkt)

> Geschreven 2026-06-10 door Atlas. Doel: precies uitleggen hoe dit systeem in elkaar zit,
> hoe je het draait, hoe je een frontend koppelt, en hoe het multi-shop/multi-kanaal-overzicht werkt.
> Geverifieerd tegen de live draaiende stack (echte browser + API-smoke), niet alleen unit-tests.

---

## 1. Wat is dit?

Eén **command center** voor al je verkoop:
- **Eigen webshop(s)** — je koppelt er elke frontend aan (headless): de site laadt producten, pagina's, blogs en menu's vanuit dit systeem via een API + token.
- **Marktplaatsen** — Bol.com en Amazon zijn *koppel-klaar* (sleutels invullen, geen code).
- **Eén beheer** — producten, voorraad, orders, klanten, CMS-content en boekhouding op één plek, per winkel én geconsolideerd.

Eén database, meerdere shops (multi-tenant). Je kiest na het inloggen een winkel, of bekijkt alles samen op het dashboard.

---

## 2. Architectuur in het kort

| Onderdeel | Wat | Poort | Stack |
|---|---|---|---|
| **API** | de motor (data, auth, business-logica) | `:7300` | Hono + Drizzle ORM |
| **Admin** | het beheerscherm (waar jij in werkt) | `:7301` | React + TanStack |
| **Database** | embedded PostgreSQL (geen Docker nodig) | `:7432` | data in `.pgdata/` |
| **Storefront-SDK** | klein JS-bestand dat een externe frontend aan de API hangt | — | `apps/storefront/sdk/` |

De admin praat met de API; de API praat met de database. Een gekoppelde frontend praat met de
**storefront-API** (`/api/storefront/v1/*`) via een publishable token.

---

## 3. Starten (3 processen, geen Docker)

Vanuit de repo-root `C:\ClaudeAgents\shared\from-agent1\webshop-crm`:

```bash
# 1) Database (embedded Postgres, blijft draaien — start in achtergrond)
node scripts/dev-db.mjs

# 2) API
pnpm --filter @webshop-crm/api dev

# 3) Admin
pnpm --filter @webshop-crm/admin dev
```

- **Inloggen:** http://localhost:7301 → `admin@webshop-crm.local` / `admin12345`
- **Flow:** login → **/launch** (kies een winkel) → het beheerscherm.

### Verse database opzetten (of na reset)
```bash
pnpm db:migrate          # schema aanmaken
pnpm db:seed             # admin + locatie + btw-tarieven + 3 kanalen
pnpm db:seed-demo        # 50 demo-producten
pnpm db:seed-demo-shops  # 2 demo-shops met CMS-content, blog, orders
```

---

## 4. ⚠️ Eerst dít checken als "niets werkt"

**Symptoom dat je eerder had:** inloggen lukt niet, voorraad niet aanpasbaar, alles lijkt stuk.
**Oorzaak in 9/10 gevallen:** de **database draait niet** (proces 1 staat uit, of `.pgdata` is corrupt).
De API blijft dan "online" lijken, maar elke actie geeft een 500.

Controleer in deze volgorde:
```bash
# A) Draait de DB écht? Dit raakt de database (niet alleen de API):
curl http://localhost:7300/health/ready
#   → {"ok":true,"db":"ok"}  = goed
#   → 503 / geen antwoord     = DB ligt eruit → start proces 1 opnieuw

# B) Werkt de hele keten? (login → product → storefront → order → grootboek)
node scripts/smoke-api.mjs
#   → eindigt met SMOKE_PASS = alles werkt echt
```

> **Let op het verschil:** `/health` (zonder `/ready`) zegt alleen "API-proces leeft" en raakt de DB
> *niet* — die kan dus "OK" zeggen terwijl de database plat ligt. Gebruik altijd **`/health/ready`**
> of de **smoke** om te weten of het écht werkt. Dit is waarom achtergrond-tests "groen" konden zijn
> terwijl de praktijk faalde: die tests draaien tegen een aparte test-database, niet tegen je live DB.

**Login-foutmelding 429 ("te veel pogingen"):** de login is beveiligd met rate-limiting
(10 pogingen per 15 min per IP). Even wachten of minder vaak proberen — dit is geen bug.

**Database resetten** (alle dev-data weg, verse demo erin):
```bash
# stop proces 1, dan:
#   verplaats of verwijder de .pgdata-map, daarna proces 1 opnieuw starten
#   (maakt automatisch een verse cluster), gevolgd door de migrate+seed-commando's uit §3.
```

---

## 5. Een frontend koppelen (headless) — de kern van wat je wilt

Elke website (statisch, Next.js, WordPress, de site van iemand anders) kan producten **én** content
uit dit systeem laden via een publishable token. Geen wachtwoord op de site nodig — het token is
publiek-veilig (alleen-lezen storefront + cart/checkout), net als bij Shopify/Medusa.

### Stappen in de admin
1. **Shops → kies de winkel → tab/paneel "Koppel je webshop".**
2. Klik **"Genereer token"** → je krijgt eenmalig een sleutel `wcrm_pk_…`. **Kopieer en bewaar 'm** (hij wordt gehasht opgeslagen, je ziet 'm maar één keer).
3. Zet de **API-base** klaar: `https://<jouw-crm-host>/api/storefront/v1` (lokaal: `http://localhost:7300/api/storefront/v1`).
4. Vul bij **allowed-origins** het webadres van de frontend in (bijv. `https://shop-van-mijn-vriendin.nl`), zodat de browser-CORS klopt.
5. Gebruik **"Test verbinding"** om te bevestigen dat het token werkt.

### In de frontend
Elke storefront-call stuurt de header `X-Storefront-Token: wcrm_pk_…`. De beschikbare endpoints:

| Endpoint | Levert |
|---|---|
| `GET /products` | productenlijst |
| `GET /products/:slug` | één product (varianten, prijs, voorraad) |
| `GET /pages/:slug` | een CMS-pagina (blocks + SEO) |
| `GET /blog` | blogposts |
| `GET /menus` | navigatie-menu's |
| `POST /cart` → `/cart/:token/items` → `/cart/:token/checkout` | winkelmand & afrekenen |

**Snelste weg:** gebruik de meegeleverde SDK `apps/storefront/sdk/webshop-crm-sdk.js`
(zie `apps/storefront/sdk/README.md` + `example.html`). Eén `<script>` insluiten, `apiBase` + `token`
invullen, en je kunt `sdk.products()`, `sdk.page('over-ons')`, `sdk.addToCart(...)` aanroepen.
> De SDK moet via http(s) geladen worden (ES-module-import werkt niet vanaf `file://`).

**Snelheid:** de frontend blijft snel omdat hij alleen JSON ophaalt en zelf rendert — de CRM doet
geen zware rendering. Cache de `/products` en `/pages`-responses op de frontend (ze veranderen weinig).

---

## 6. Producten & voorraad

1. **Producten → Nieuw product** → titel, (optioneel) varianten/opties → **Opslaan**.
   - *Sinds de fix van 2026-06-10:* elk nieuw product krijgt automatisch een **voorraad-item** + een
     begin-voorraad (0) op je hoofd-locatie. Daardoor verschijnt het meteen in **Voorraad** en kun je
     de aantallen aanpassen. (Daarvóór ontbrak dit, waardoor "voorraad aanpassen" niet lukte.)
2. **Voorraad** → zoek het product → open het → **Adjust** → vul een mutatie in (bijv. +10, reden
   "Ontvangst") → **Opslaan**. Je ziet de nieuwe on-hand + een mutatieregel in de historie.
3. Meerdere magazijnen/locaties: beheer ze onder **Locaties**; je kunt per locatie voorraad bijhouden.

---

## 7. Pagina's, blogs & foto's (content-CMS)

- **CMS → Pagina's**: maak landingspagina's met blocks (tekst/afbeelding/etc.) + SEO-velden. Status
  **concept/gepubliceerd** bepaalt of de storefront ze toont.
- **CMS → Blog**: blogposts met cover-afbeelding en SEO.
- **CMS → Menu's**: navigatie die de frontend via `/menus` ophaalt.
- **CMS → Media**: afbeeldingen; je koppelt ze via hun URL aan pagina's/producten.
- De gekoppelde frontend haalt dit op via `/pages/:slug`, `/blog`, `/menus` (zie §5).

---

## 8. Meerdere winkels, kanalen & het geconsolideerde overzicht

- **Winkel kiezen:** na login kies je op **/launch** een winkel; rechtsboven wissel je van winkel.
- **Dashboard:** toont KPI's (omzet 30d, openstaande orders, etc.) **per winkel én over alles samen**;
  je kunt filteren op winkel en op kanaal (web/Bol/Amazon).
- **Orders-inbox:** "Alle shops + alle kanalen" met kanaal-chips, zodat je openstaande orders overal
  in één lijst ziet.
- **Financieel/Boekhouding:** geconsolideerde omzet/marge/btw met per-kanaal-uitsplitsing.

### ⚠️ Belangrijke beperking nu (eerlijk)
"Totale omzet alles bij elkaar" telt op dit moment **vooral je eigen-webshop-omzet**. Bol/Amazon-orders
worden bij synchronisatie nog in een *staging-tabel* gezet en **niet als volwaardige order
gematerialiseerd**, dus ze tellen nog niet mee in het totaal. Dit is het belangrijkste punt op de
roadmap (zie `SYSTEEM-OORDEEL-EN-ROADMAP.md`, gap #1) — nodig om écht "alle accounts bij elkaar" te zien.

---

## 9. Kanalen (Bol/Amazon) & betalingen koppelen — later live zetten

- **Kanalen → Configureren:** vul je API-sleutels in (Bol: clientId/clientSecret; Amazon: LWA
  clientId/clientSecret + refreshToken + sellerId) → **"Test verbinding"** → status wordt `connected`
  → **"Sync nu"**. Geen code nodig; zonder sleutels blijft het kanaal netjes "credentials required".
- **Betalingen (Mollie):** per winkel onder **Shops → <winkel> → Betalingen** een Mollie-key invullen
  (`test_…`/`live_…`). Zonder key blijft de checkout "test-betaald" (niets breekt).

---

## 10. Waar staat wat (voor de techniek)

- API-routes: `apps/api/src/routes/*` (o.a. `products`, `stock`, `orders`, `cms`, `channels`, `storefront`, `finance`).
- Admin-schermen: `apps/admin/src/routes/_app/*` + `components/*`.
- Database-schema: `apps/api/src/db/schema/*`. Migraties: `apps/api/drizzle/*`.
- Storefront-SDK: `apps/storefront/sdk/*`.
- Health: `GET /health` (alleen API-leven) en **`GET /health/ready`** (DB-check).
- Live-test: `node scripts/smoke-api.mjs`.

## Multi-user: anderen met eigen accounts en eigen webshops

Sinds de multi-user-uitbreiding kunnen derden een eigen account aanmaken en hun
eigen webshop(s) aan dit CMS hangen, volledig gescheiden van jouw data.

**Hoe het werkt**
- Registreren: `/register` in de admin-UI (of `POST /api/auth/register`).
  Nieuwe accounts krijgen rol `user` (tenant); de operator blijft de enige `admin`.
- Een tenant ziet alleen shops waar hij lid van is (tabel `shop_members`).
  Wie een shop aanmaakt wordt automatisch **owner**; owners kunnen via het
  Leden-paneel op de shop-detailpagina anderen toevoegen (op e-mailadres).
- Producten hebben een eigenaar (`products.owner_user_id`). Tenants zien en
  beheren alleen hun eigen producten + bijbehorende voorraad en afbeeldingen.
  Bestaande producten (eigenaar NULL) zijn platform-catalogus: alleen admin.
- Orders/klanten/retouren/CMS-content/kortingen zijn per shop gescoped;
  het dashboard van een tenant telt alleen zijn eigen shops.
- Admin-only modules voor tenants (403): kanalen (Bol/Amazon), finance/
  boekhouding/grootboek, inkoop, locaties, verzending, marketing-feeds,
  analytics, notificaties, webhooks, reviews, audit-log en gebruikersbeheer.
- De admin (jij) ziet alles geconsolideerd: alle shops, producten en omzet.

**Webshop koppelen als tenant**: shop aanmaken → shop-detail → "Koppel je
webshop" → token genereren → externe frontend stuurt
`X-Storefront-Token: wcrm_pk_…` mee naar `/api/storefront/v1/*`.

**Verificatie**: `node scripts/smoke-multiuser.mjs` draait de hele keten
(registratie → shop → token → product → storefront + isolatie-checks).
