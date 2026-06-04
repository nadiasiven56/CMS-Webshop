# DEV-SETUP — Webshop-CRM

Dit document beschrijft hoe je een lokale development-omgeving voor
Webshop-CRM opzet en draait. Geschreven door de Fase 1 finalizer.

## Prerequisites

- **Node.js** ≥ 22.0
- **pnpm** ≥ 9.0 (`npm install -g pnpm@9` als nog niet geïnstalleerd)
- **Docker Desktop** (running) — voor Postgres 16 + Redis 7

## Initial setup (eenmalig)

```sh
# 1. Vanaf project-root (waar package.json staat):
pnpm install

# 2. .env aanmaken op basis van .env.example:
cp .env.example .env
# Open .env in je editor en zet ten minste:
#   SESSION_SECRET=<32+ random hex chars>
#   CHANNEL_SECRET_KEY=<32+ random hex chars>
#   SEED_ADMIN_PASSWORD=<wat je wilt — bewaar voor login>
#
# Genereer een random hex-string met:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Start Postgres + Redis:
pnpm db:up

# 4. Run initial migration:
pnpm db:migrate

# 5. Seed: 1 admin-user + 1 default-location 'main':
pnpm db:seed

# 6. (Optioneel maar aanbevolen voor ontwikkeling) 50 demo-products + varianten + stock:
pnpm db:seed-demo
```

Alles klaar? Door naar "Daily workflow".

## Daily workflow

```sh
# Postgres + Redis (als Docker nog niet draait):
pnpm db:up

# Start API (:7300) + Admin (:7301) parallel:
pnpm dev
```

## URLs

| URL | Wat |
|---|---|
| `http://localhost:7300/health` | API health-check, verwacht `{"ok":true,...}` |
| `http://localhost:7301` | Admin UI (login-scherm, AI Centrum-thema) |
| `http://localhost:7300/api/auth/me` | Sessie-check (na login) |
| `http://localhost:7300/storage/...` | Static-serve voor uploaded images |

**Admin-login**:
- Email: `admin@webshop-crm.local` (of wat je in `SEED_ADMIN_EMAIL` zette)
- Password: wat je in `SEED_ADMIN_PASSWORD` zette

## Tests

```sh
# Alle vitest unit-tests (api + admin + shared):
pnpm test

# Alleen API-tests:
pnpm --filter @webshop-crm/api test

# Alleen Admin-tests:
pnpm --filter @webshop-crm/admin test

# E2E (Playwright) — admin moet draaien op :7301 + DB geseed:
E2E_ADMIN_PASSWORD=<seed-password> pnpm test:e2e
```

Voor de eerste E2E-run nog éénmalig browser-binaries installeren:
```sh
pnpm --filter @webshop-crm/admin exec playwright install chromium
```

## Database reset

```sh
# Volledige reset (drop + recreate Docker-volumes):
pnpm db:reset

# Daarna opnieuw migrate + seed:
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm db:seed-demo
```

## Veelgebruikte scripts (overzicht)

| Script | Wat |
|---|---|
| `pnpm dev` | Start api + admin parallel |
| `pnpm typecheck` | `tsc --noEmit` over alle workspaces |
| `pnpm test` | Vitest unit-tests over alle workspaces |
| `pnpm test:e2e` | Playwright happy-path |
| `pnpm db:up` | Postgres + Redis up |
| `pnpm db:down` | Stop containers (data blijft) |
| `pnpm db:reset` | Stop + drop volumes (data weg!) |
| `pnpm db:migrate` | Run Drizzle-migrations |
| `pnpm db:generate` | Drizzle-kit genereert nieuwe migration uit schema |
| `pnpm db:seed` | 1 admin-user + 1 default-location |
| `pnpm db:seed-demo` | 50 demo-products + varianten + stock + images |

## Troubleshooting

### `Postgres connection refused` / `ECONNREFUSED 127.0.0.1:5432`
- Check Docker Desktop draait.
- Check container running: `docker ps` — verwacht `webshop-crm-pg` of vergelijkbaar.
- Check logs: `pnpm db:logs`.

### `Port 7300 / 7301 / 5432 / 6379 in use`
- Andere process gebruikt poort. Stop met:
  - Windows: `netstat -ano | findstr :7300` → `taskkill /PID <pid> /F`
  - macOS/Linux: `lsof -i :7300` → `kill <pid>`
- Of pas port aan in `.env` (`API_PORT`, `ADMIN_PORT`).

### `Cannot find module '@webshop-crm/shared'`
- pnpm-workspace-link is niet gemaakt. Re-run: `pnpm install`.
- Verifieer dat `@webshop-crm/shared` als `workspace:*` staat in `apps/api/package.json`
  én `apps/admin/package.json`.

### `routeTree.gen.ts` errors / "module not found"
- Het bestand wordt gegenereerd door `@tanstack/router-plugin/vite`.
- Run éénmalig `pnpm --filter @webshop-crm/admin dev` — Vite genereert dan
  `routeTree.gen.ts` automatisch. Daarna stoppen + `pnpm dev` werkt.

### `Drizzle migration` foutmeldt op kolom-mismatch
- Foundation-migration `0000_initial_foundation.sql` is handmatig samengesteld.
  Bij drift met schema-files: drop migration + journal + run `pnpm db:generate`:
  ```sh
  rm apps/api/drizzle/0000_initial_foundation.sql
  rm apps/api/drizzle/meta/_journal.json
  pnpm db:generate
  pnpm db:reset
  pnpm db:up
  pnpm db:migrate
  pnpm db:seed
  ```
- Atlas-flag bij start: gebruik dit alléén als je weet wat je doet.

### Login geeft 401 / sessie raakt direct kwijt
- Cookies worden alleen op `localhost` gezet. Ga naar `http://localhost:7301`,
  NIET `127.0.0.1:7301` (anders mismatch met API-cors-allowlist).
- Check `SESSION_SECRET` in `.env` — niet leeg.

### `pnpm db:seed-demo` zegt "skip"
- Demo-products bestaan al (slug LIKE `demo-%`). Dat is OK; idempotent.
- Wil je opnieuw seeden? `pnpm db:reset` → `pnpm db:up` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm db:seed-demo`.

## Volgende fasen

Fase 1 is foundation + admin-CRUD voor producten / varianten / voorraad / images.

- **Fase 2**: storefront-API (`/storefront/v1/*`) + 1 webshop-template aansluiten
- **Fase 3**: channels (Google Merchant Center + Bol.com)
- **Fase 4**: ledger + BTW + boekhoud-export (Moneybird / UBL)
- **Fase 5**: Amazon SP-API + verzending (Sendcloud) + V1-go-live

Zie `docs/V1-ROADMAP.md` voor de volledige roadmap en acceptance-criteria.
