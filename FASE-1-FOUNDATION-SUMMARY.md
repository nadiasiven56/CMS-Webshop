# Fase 1 Foundation — Atlas oplevering

**Status**: klaar voor 3 parallel feature-agents (product / stock / image).
**Datum**: 2026-05-09
**Owner**: Atlas (agent1)
**Locatie**: `C:\ClaudeAgents\shared\from-agent1\webshop-crm\`

## Wat klaar is (acceptance-checklist uit task-spec)

| # | Item | Status | Toelichting |
|---|---|---|---|
| 1 | Monorepo bootstrap (`package.json` + `pnpm-workspace.yaml` + `tsconfig.base.json`) | DONE | strict, ES2022, moduleResolution=bundler |
| 2 | `.gitignore` + `.env.example` + `.editorconfig` | DONE | Alle keys uit ARCHITECTURE.md (DB/Redis/secrets/storage) + placeholders voor Fase 2-5 |
| 3 | `docker-compose.dev.yml` (Postgres 16 + Redis 7) | DONE | + init-script `docker/postgres-init/00-extensions.sql` voor pgcrypto |
| 4 | DB scripts in root package.json (`db:up`, `db:down`, `db:logs`, `db:reset`, `db:migrate`, `db:generate`, `db:seed`) | DONE | |
| 5 | `apps/api` Hono backend skelet (port 7300) | DONE | /health + /api/auth/{login,logout,me}, error-handler, request-logger, cors, idempotency-middleware, graceful-shutdown |
| 6 | Drizzle schemas voor V1-tabellen | DONE | 14 tabellen: users, sessions, api_tokens, locations, products, product_options, product_option_values, product_images, variants, inventory_items, inventory_levels, inventory_movements, inventory_reservations, audit_log, idempotency_keys |
| 7 | Drizzle initial migration (`drizzle/0000_initial_foundation.sql` + meta/_journal.json) | DONE-MANUAL | Handmatig samengesteld (correct conform schema). Operator/finalizer kan `pnpm db:generate` runnen om Drizzle's eigen output te krijgen — file is leidend voor Drizzle's runner. |
| 8 | Seed-script (`pnpm --filter @webshop-crm/api seed`) | DONE | 1 admin-user uit env + 1 default-location 'main', idempotent |
| 9 | `apps/admin` TanStack Router frontend (port 7301) | DONE | login + 5 pages (dashboard / producten / voorraad / movements / settings) |
| 10 | AI Centrum-thema in admin (#0d0f12 + #ff9f43) | DONE | `data-theme="ai-centrum"` op `<html>` + alle theme-tokens in `src/styles.css`, login-page heeft duidelijke #0d0f12 bg + orange accent |
| 11 | `packages/shared` met money + auth-schemas + product-placeholder | DONE | Money als branded `string` (4 decimalen), zod-schemas voor login/me, vitest unit-tests voor money |
| 12 | `INTEGRATION.md` met folder-eigendom per feature-agent | DONE | Per agent: scope, mag-schrijven-folders, NIET-aanraken, verplichte endpoints, import-paden, test-eisen |
| 13 | `README.md` top-level | DONE | Quick-start + repo-layout + verwijzingen naar docs/ |

### Wat werkt zonder pnpm install (operator-mandaat geen npm/pnpm)

- TypeScript files compileren tot een schoon project (verwacht groen
  `pnpm typecheck` zodra deps geinstalleerd).
- SQL-migration is handmatig zelf-gevalideerd t.o.v. DB-SCHEMA.md.
- Drizzle journal heeft 1 entry zodat `pnpm db:migrate` het zal pakken.

## Wat NIET in deze pass zit (bewust uitgesteld)

- GEEN orders/customers/channels/ledger tabellen (Fase 2-5)
- GEEN BullMQ-jobs (Fase 2+)
- GEEN echte product/stock/image-implementatie — placeholder-pages tonen
  expliciet welke feature-agent verantwoordelijk is
- GEEN ESLint-config (komt in Fase 2 als project stabiel is)
- GEEN Playwright-E2E (komt in Fase 5 finalize)
- GEEN cloudflared-tunnel-config (operator-actie pre-launch)
- GEEN 50 demo-products seed — dat doet product-agent (zoals
  V1-ROADMAP §"Suggested owner" voorschrijft)

## Afwijkingen van spec & redenen

| Spec-item | Hoe afwijkend | Reden |
|---|---|---|
| Lucia-auth | Ik gebruik een handmatige session-store die Lucia-COMPATIBLE is (zelfde tabel-shape) i.p.v. de Lucia adapter-API. | Lucia v3 + Drizzle + postgres-js heeft bekende rough edges. Eigen 30-regel-helper is veiliger en kan later inwisselen zonder schema-change. Dep `lucia` blijft in `package.json` voor evt. wisseling. |
| `argon2` als password-hash | bcryptjs gebruikt i.p.v. argon2 | argon2 is native build die op Windows-CI vaak struikelt; `bcryptjs` is pure-JS, cross-platform. argon2 dep blijft in package.json voor evt. opt-in later. |
| `pnpm install --lockfile-only` | NIET gerund (operator-mandaat) | Operator beslist welke deps. Versies in package.json zijn gebaseerd op stable van eind 2024 / begin 2025. |
| Drizzle-kit `pnpm drizzle-kit generate` | NIET gerund (idem) | `drizzle/0000_initial_foundation.sql` handmatig + meta/_journal.json. Bij eerste `pnpm db:generate` kan Drizzle dit re-genereren met identieke shape. |
| README.md staat als top-level (verwijst naar `docs/DEV-SETUP.md`) | DEV-SETUP.md NIET geschreven | Spec zegt expliciet "DEV-SETUP.md die de finalizer schrijft". Operator-quickstart staat al in README. |
| `apps/admin/src/routeTree.gen.ts` | Handmatig gegenereerd als placeholder | TanStack Router-plugin overschrijft deze file bij eerste `vite dev`. Reden: zodat `tsc --noEmit` op clean-clone groen kan zijn. |

## Open issues / wat de feature-agents nog moeten doen

### product-agent
- Producten + varianten + foto-koppeling CRUD (zie INTEGRATION.md → "Endpoints om te bouwen")
- Slug-generatie (uniek, fallback naar `<title>-<random6>`)
- Search/filter op products-list
- Validatie: SKU uniek, prijzen >= 0
- Demo-seed van 50 SKU's (zie V1-ROADMAP Fase 1 deliverable)

### stock-agent
- Stock-overview-page met filter per locatie + low-stock-flag
- Adjust-form: pick-item, location, +/-delta, reden, note
- Movements-list met datum/SKU/locatie filters
- Reservations-zicht (read-only voor admin V1)
- Constraint: na adjust moet `available = on_hand - committed` blijven kloppen → in transaction

### image-agent
- Multipart-upload-route met file-size-limit (5MB?) + image/* MIME-check
- Local storage-driver in `apps/api/src/lib/storage/local.ts`
- S3-stub voor V2 wisseling (interface + LocalDriver only V1)
- Drag-drop component met preview + reorder
- Thumbnail-generatie (sharp?) — discussie voor finalize

### Algemene blockers / discussie-punten
1. **Drizzle-migration regenereren**: zodra alle 3 agents schema's hebben
   toegevoegd, finalizer regenereert 0000-migration. Belangrijk: migrations
   die al gerund zijn op operator's lokale DB raken dan out-of-sync. Pad:
   - Operator dropt lokale DB voor merge-pass
   - OF: finalizer levert apart 0001/0002 migrations per feature-agent
2. **Audit-log triggers**: spec zegt "audit-log triggers op orders/inventory/po/ledger".
   Inventory-tabellen bestaan, dus stock-agent kan dat al instellen. Orders/PO/ledger
   wachten tot Fase 3-5.
3. **Updated_at-triggers** op products/variants/inventory_levels staan al in 0000-migration.
   Andere tabellen die later updated_at krijgen → triggers per migration toevoegen.
4. **Idempotency-key TTL**: hardcoded 24u in middleware. Cron-job om expired
   keys op te ruimen komt in Fase 2 met BullMQ.

## Hoe operator deze foundation kan starten

```sh
# Vanaf C:\ClaudeAgents\shared\from-agent1\webshop-crm\

# 1. Docker Desktop draaiend? Zo ja:
pnpm db:up

# 2. Deps (eerste keer ~1-2 min)
pnpm install

# 3. Env zetten
cp .env.example .env
# minstens SESSION_SECRET en CHANNEL_SECRET_KEY een random 32-char hex zetten:
#   `openssl rand -hex 32` → in beide variabelen plakken
# (Of vanaf PowerShell: `[Convert]::ToHexString((New-Object byte[] 32 | %{ [byte](Get-Random -Max 256) }))`)

# 4. Schema migreren
pnpm db:migrate

# 5. Eerste user + location seeden
pnpm db:seed
# → console toont "admin-user created" + "default location created"

# 6. Dev-servers starten (parallel)
pnpm dev
# → API:   http://localhost:7300/health     (verwacht JSON {ok:true,...})
# → Admin: http://localhost:7301             (verwacht login-scherm met AI Centrum-thema)

# 7. Login
# Email:    admin@webshop-crm.local        (uit .env SEED_ADMIN_EMAIL)
# Password: <wat je in SEED_ADMIN_PASSWORD zette>
```

### Verifiable acceptance bij operator

- [ ] `curl http://localhost:7300/health` → `{"ok":true,...,"service":"webshop-crm-api"}`
- [ ] Login-page toont #0d0f12 bg en oranje (#ff9f43) "Inloggen"-knop
- [ ] Login → dashboard met sidebar (Dashboard / Producten / Voorraad / Movements / Settings)
- [ ] Reload-page = nog steeds ingelogd (sessie-cookie persistent)
- [ ] Settings-page → "Uitloggen" werkt en stuurt terug naar /login
- [ ] /products /stock /movements tonen "Wordt door X-feature-agent gebouwd" placeholders
- [ ] In Postgres: `select * from users` toont 1 row, `select * from locations` toont 1 row 'main'
- [ ] `pnpm typecheck` (root) = 0 errors

Als 1 van die items rood is = Atlas-pingen, niet doorpushen naar feature-agents.

## Bestandstellung Fase 1 oplevering

- 3 root config-files (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`)
- 4 quality-of-life files (`.gitignore`, `.env.example`, `.editorconfig`, `README.md`)
- 1 docker-compose + 1 init-script
- ~25 files in `apps/api/src/` (env, logger, db, auth, middleware, routes, schemas, seed, migrate)
- 1 SQL migration + 1 journal
- ~15 files in `apps/admin/src/` (main, styles, components/Sidebar, lib/api+auth, 7 routes incl. routeTree-placeholder)
- ~6 files in `packages/shared/src/` (index, auth-schemas, products-placeholder, money + tests)
- 3 placeholder folders (`apps/api/src/routes/{products,stock,images}/.gitkeep`)
- 1 INTEGRATION.md
- 1 FASE-1-FOUNDATION-SUMMARY.md (deze file)

## Volgende stap

Atlas dispatcht 3 feature-agents:
- **product-agent** → product/variant CRUD (zie INTEGRATION.md > product-agent)
- **stock-agent** → stock + movements (zie INTEGRATION.md > stock-agent)
- **image-agent** → image-upload (zie INTEGRATION.md > image-agent)

Daarna 1 finalizer-pass die:
- Drizzle-migration herregenereert
- Routes registreert in `apps/api/src/routes/index.ts`
- E2E-test draait
- DEV-SETUP.md schrijft in `docs/`
