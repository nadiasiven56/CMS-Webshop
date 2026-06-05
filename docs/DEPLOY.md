# DEPLOY — Webshop-CRM naar productie

Dit is het draaiboek om de CMS **live** te zetten op een eigen server (VPS / dedicated /
eigen machine met Docker). De hele stack draait met **één commando** en is daarna
klaar om de externe koppelingen (Bol, Amazon, Mollie, boekhouding, verzending, e-mail)
te activeren door alleen je sleutels in te vullen.

> **Status van de codebase (geverifieerd op 2026-06-05)**
> - typecheck groen — api 0 fouten, admin 0 fouten
> - productie-builds groen — `api → dist`, `admin → dist`
> - tests groen — **shared 8/8 · api 293/293** (admin-e2e draait apart via Playwright)
> - runtime bewezen — API in **`NODE_ENV=production`** + end-to-end **SMOKE_PASS**
>   (login → storefront → checkout → betaalde order → gebalanceerde ledger → dashboard-KPI's)

---

## 1. Architectuur in het kort

Eén publieke origin achter **Caddy**; daarachter de API en Postgres op een privaat netwerk.

```
            ┌──────────────────────── server (Docker) ───────────────────────┐
 https ───► │  admin (Caddy)                                                  │
 :443       │   ├─ /            → static admin-SPA                            │
            │   └─ /api,/storage,/health → reverse-proxy ─► api (Hono, :7300) │
            │                                                  └─► postgres:5432│
            └─────────────────────────────────────────────────────────────────┘
```

- **Eén origin** = de sessie-cookie blijft same-origin (`HttpOnly; SameSite=Lax; Secure`),
  geen CORS-gedoe.
- **Auto-HTTPS**: Caddy haalt en vernieuwt automatisch een Let's Encrypt-certificaat
  zodra `SITE_ADDRESS` een echt domein is.
- **API-runtime = `tsx`** (geen native deps) → slanke, node-versie-onafhankelijke image.
- Bij elke container-start: **migraties** (met retry tot de DB klaar is) + **idempotente seed**.

Bestanden:
| Bestand | Wat |
|---|---|
| `docker-compose.prod.yml` | de 3 services (postgres / api / admin) |
| `apps/api/Dockerfile` | API-image (tsx-runtime) |
| `apps/admin/Dockerfile` | admin-build → Caddy-image |
| `apps/admin/Caddyfile` | static-serve + reverse-proxy |
| `docker/entrypoint.sh` | migrate → seed → serve |
| `.env.production.example` | template voor alle productie-variabelen |

---

## 2. Vereisten

- Een server met **Docker Engine** + **Docker Compose v2** (`docker compose version`).
- Poorten **80** en **443** open naar de server.
- Een **domein** met een **A-record** dat naar het server-IP wijst (bv. `crm.jouwdomein.nl`).
  (Voor een snelle test zonder domein kun je ook op `:80` draaien — zonder HTTPS, zie §6.)

---

## 3. Deploy in 5 stappen

```sh
# 1) Code op de server
git clone https://github.com/nadiasiven56/CMS-Webshop.git webshop-crm
cd webshop-crm

# 2) Productie-config aanmaken
cp .env.production.example .env.production

# 3) Secrets genereren en invullen
openssl rand -hex 32      # → plak als SESSION_SECRET
openssl rand -hex 32      # → plak als CHANNEL_SECRET_KEY
openssl rand -hex 24      # → plak als POSTGRES_PASSWORD  (hex = URL-veilig!)
#   Vul verder in: PUBLIC_URL, SITE_ADDRESS,
#   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD   (zie de TODO-regels in het bestand)
nano .env.production

# 4) Bouwen + starten
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

# 5) Volgen tot alles healthy is
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api      # zie: migraties OK → seed → API listening
```

Open daarna **`https://crm.jouwdomein.nl`** en log in met `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD`. Klaar.

> Tip: zet het lange compose-commando in een alias:
> `alias dc='docker compose --env-file .env.production -f docker-compose.prod.yml'`
> → daarna simpelweg `dc up -d --build`, `dc logs -f api`, `dc down`.

---

## 4. Wat er automatisch gebeurt bij `up`

1. **postgres** start en wordt healthy (`pg_isready`).
2. **api** wacht daarop, draait dan de 12 Drizzle-migraties (met retry), en seedt
   idempotent: admin-user + default-locatie + BTW-tarieven + 3 kanalen.
3. **admin** (Caddy) start, vraagt een TLS-certificaat aan voor je domein en gaat
   `/api` proxyen naar de api-container.

Een verse DB is dus na `up` meteen bruikbaar — geen handmatige migrate/seed nodig.

---

## 5. Koppelingen activeren ("sleutel erin → het werkt")

Alle externe koppelingen zijn **koppel-klaar** en zitten achter een `requireCreds`-guard:
zonder sleutels gebeurt er niets, mét sleutels gaat de koppeling live — **zonder code-wijziging**.
De sleutels worden **versleuteld in de database** opgeslagen (AES-256-GCM via
`CHANNEL_SECRET_KEY`), niet in env-bestanden. Volledige officiële onboarding per dienst:
**`docs/CONNECT-OFFICIAL.md`**.

| Koppeling | Waar in de admin | Wat invullen |
|---|---|---|
| **Eigen webshop** (storefront) | Shops → *Koppel je webshop* | publishable token `wcrm_pk_…` + SDK-snippet in je shop plakken |
| **Bol.com** (Retailer API v10) | Kanalen → Bol → Configureren | `clientId` + `clientSecret` (+ demo/productie) → Test → Sync |
| **Amazon** (SP-API) | Kanalen → Amazon → Configureren | LWA `clientId`/`clientSecret` + `refreshToken` + `sellerId` + marketplace |
| **Mollie** (betalingen) | Shops → <shop> → Betalingen | API-key `test_…`/`live_…` (per shop) |
| **Boekhouding** | Instellingen → Boekhoud-koppeling | Moneybird / Exact / e-Boekhouden credentials |
| **Verzending** | Verzending | Sendcloud / MyParcel / PostNL credentials |
| **E-mail** | Instellingen / Marketing | Postmark / SendGrid / Mailgun / SMTP |
| **Reviews** | Reviews | Kiyoh / Trustpilot / Google |
| **Marketing-feeds** | Marketing | Google Shopping / Meta feed-URLs |

Na het invullen draait de **achtergrond-scheduler** (`SCHEDULER_ENABLED=true`) de
periodieke sync (orders ophalen, voorraad pushen) automatisch.

---

## 6. Varianten

**Lokaal/IP testen zonder HTTPS** — in `.env.production`:
```
SITE_ADDRESS=:80
PUBLIC_URL=http://SERVER_IP
COOKIE_SECURE=false
```
De sessie-cookie krijgt standaard `Secure` zodra `PUBLIC_URL` https is; browsers
weigeren een `Secure`-cookie over plain HTTP. Voor een login-test over http zet je
daarom **`COOKIE_SECURE=false`** (de cookie is dan zónder `Secure`). Je hoeft dus
**niet** meer `NODE_ENV=development` te misbruiken — `COOKIE_SECURE` is hiervoor de
nette, van `NODE_ENV` ontkoppelde knop.

**Achter een bestaande reverse-proxy / Cloudflare Tunnel** — laat Caddy op `:80`
(`SITE_ADDRESS=:80`) en laat je bestaande proxy de TLS-terminatie doen; route al het
verkeer naar de admin-container. Extern is het verkeer **https**, intern **http**.
Zet daarom expliciet:
```
SITE_ADDRESS=:80
PUBLIC_URL=https://crm.jouwdomein.nl     # je EXTERNE https-adres
COOKIE_SECURE=true
```
en zorg dat de tunnel/proxy **`X-Forwarded-Proto: https`** (en `X-Forwarded-For`)
doorzet. Zónder `COOKIE_SECURE=true` zou de cookie hier ten onrechte zonder `Secure`
gaan (omdat Caddy intern http spreekt); mét deze instelling klopt 'ie weer.

---

## 7. Beheer

```sh
# Status / logs
dc ps
dc logs -f api
dc logs -f admin

# Updaten naar nieuwe code
git pull
dc up -d --build           # migraties draaien automatisch opnieuw (idempotent)

# Stoppen (data blijft) / volledig verwijderen (data blijft in volumes)
dc down
dc down                    # volumes blijven; voeg -v toe om ze te WISSEN (let op!)

# Database-backup (cron-waardig)
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U webshop webshop_crm | gzip > backup-$(date +%F).sql.gz

# Database-restore
gunzip -c backup-2026-06-05.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U webshop -d webshop_crm
```

Volumes: `pgdata` (database), `storage` (geüploade productfoto's), `caddydata`
(TLS-certificaten). Neem **`pgdata` en `storage`** mee in je back-upschema.

---

## 8. Beveiligings-checklist (vóór go-live)

- [ ] `SESSION_SECRET` en `CHANNEL_SECRET_KEY` zijn écht random (32+ bytes), niet de placeholders.
- [ ] `SEED_ADMIN_PASSWORD` gewijzigd; eerste admin-wachtwoord sterk.
- [ ] `POSTGRES_PASSWORD` is een **hex-string** (`openssl rand -hex 24`) — geen `@ : / # ? %`
      of spaties, anders breekt de `DATABASE_URL`. Postgres staat **niet** publiek (geen
      `ports:` op de db-service — correct in deze compose).
- [ ] HTTPS actief (Caddy-certificaat afgegeven) — check `dc logs admin`.
- [ ] `COOKIE_SECURE` klopt voor je opstelling (zie §6): leeg bij auto-HTTPS,
      `true` achter een externe TLS-proxy, `false` alleen voor een lokale http-test.
- [ ] `.env.production` staat in `.gitignore` (✓ geconfigureerd) en is **niet** gecommit.
- [ ] Firewall: alleen 80/443 (en SSH) open.
- [ ] Back-up van `pgdata` + `storage` ingericht.

---

## 8a. Ingebouwde hardening (sinds security-ronde)

Deze maatregelen draaien automatisch — geen configuratie nodig, behalve waar vermeld.

- **Security-headers** — de API stuurt `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` (+ CSP `frame-ancestors 'none'`) en
  `Referrer-Policy: strict-origin-when-cross-origin`; **HSTS** (1 jaar, incl. subdomeinen)
  alleen in productie. Caddy zet dezelfde headers nóg eens op **alle** responses
  (defense-in-depth, ook voor de static admin-SPA).
- **Rate-limiting** — in-memory sliding-window per client-IP (uit `X-Forwarded-For`,
  dus zet je proxy die door): **login** 10/15 min, **storefront** & **payments**
  120/min. Bij overschrijding `429 { "error": "rate_limited" }` + `Retry-After`.
  Geldt per api-instance (één container in deze compose).
- **CORS** — gesplitst: publieke token-paden (`/api/storefront/*`, `/api/feeds/public/*`)
  reflecteren elke origin **zonder** credentials; de admin-origin (`ADMIN_PUBLIC_URL`)
  is een allowlist **mét** credentials (sessie-cookie).
- **SSRF-bescherming webhooks** — uitgaande webhook-`fetch`'es naar admin-opgegeven
  URLs worden geweigerd als ze naar een niet-publiek IP wijzen (loopback, link-local
  incl. `169.254.169.254` cloud-metadata, RFC1918); in productie alleen https; geen
  redirects naar interne hosts. Geblokkeerde pogingen worden als `success:false`
  delivery-rij gelogd.
- **Readiness-probe** — naast de goedkope liveness `GET /health` is er
  `GET /health/ready` die `select 1` op de DB doet (200 / `db:'ok'`, anders **503**).
  Geschikt als healthcheck/orchestrator-probe.
- **Log-rotatie** — elke service in `docker-compose.prod.yml` gebruikt `json-file`
  met `max-size: 10m` × `max-file: 5` (max ~50 MB per service) zodat container-logs
  de schijf niet vol laten lopen. Inspecteer met `dc logs -f <service>`.
- **Idempotency-hardening** — de `Idempotency-Key`-middleware cachet alleen 2xx en
  reserveert de key vóór de handler (`onConflictDoNothing`), zodat twee gelijktijdige
  eerste requests met dezelfde key niet beide de write draaien (de tweede krijgt de
  gecachte response of `409 idempotency_in_progress`).

---

## 9. Caveats (eerlijk)

- **Docker is niet beschikbaar op de buildmachine (`hoi`)** waarop dit is voorbereid, dus
  de image-build/compose is hier **niet** end-to-end uitgevoerd. Wat wél is bewezen:
  de exacte productie-**runtime** (`NODE_ENV=production`, `tsx`) boot + haalt de volledige
  smoke-test, en beide productie-**builds** slagen. De Docker-laag is standaard
  (Node-slim + corepack/pnpm + Caddy) en volgt deze geverifieerde runtime 1-op-1.
  Doe vóór go-live één test-`up` op de doelserver en loop §3–§4 na.
- De images installeren de volledige (frozen) workspace voor **maximale betrouwbaarheid**;
  een latere optimalisatie (`--prod` / multi-stage prune) kan ze verkleinen.
- `CHANNEL_SECRET_KEY` **nooit** wijzigen nadat er kanaal-credentials zijn opgeslagen —
  bestaande versleutelde sleutels worden dan onleesbaar (opnieuw invoeren nodig).
