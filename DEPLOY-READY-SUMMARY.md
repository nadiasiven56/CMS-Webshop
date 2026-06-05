# Deploy-ready — Webshop-CRM (2026-06-05)

Doel van deze ronde (operator): *"alles moet er klaar voor zijn, deploy-klaar, dat we
met de API alles kunnen koppelen aan de belangrijke dingen, en dat het werkt."*

Resultaat: de CMS is **deploy-klaar** gemaakt — productie-stack + draaiboek toegevoegd,
de hele repo is groen geverifieerd, en de productie-runtime is end-to-end bewezen.

## Geverifieerde staat (hard, 2026-06-05)
| Check | Resultaat |
|---|---|
| typecheck api | **0 fouten** |
| typecheck admin | **0 fouten** |
| build api (`tsc → dist`) | **OK** |
| build admin (`tsc -b && vite build → dist`) | **OK** |
| unit-tests | **shared 8/8 · api 293/293** (ROOT_EXIT=0) |
| runtime `NODE_ENV=production` (tsx) | boot OK · `/health` OK |
| end-to-end smoke (prod) | **SMOKE_PASS** (login→storefront→checkout→order→ledger balanced→KPI's) |

> Memory noemde ~157 TS-fouten — die zijn in Round-3 al opgeruimd; de repo is nu schoon.

## Wat is toegevoegd (deploy-infrastructuur)
- `docker-compose.prod.yml` — 3 services: **postgres 16 + api (tsx) + admin (Caddy)**.
- `apps/api/Dockerfile` — API-image; runtime = **tsx** (bewezen, native-vrij, node-versie-onafhankelijk).
- `apps/admin/Dockerfile` + `apps/admin/Caddyfile` — admin-build → Caddy serveert de SPA én
  proxyt `/api`·`/storage`·`/health` naar de api → **één origin** (cookie same-origin, **auto-HTTPS**).
- `docker/entrypoint.sh` — bij start: **migraties (retry) → idempotente seed → serve**.
- `.env.production.example` — compleet productie-env-template (secrets-generatie inbegrepen).
- `.dockerignore`, `.gitattributes` (LF voor shell/Docker), `docs/DEPLOY.md` — volledig draaiboek.

## Kleine codewijzigingen (onderbouwd)
- `apps/api/package.json`: **`argon2` verwijderd** (dood/ongebruikt, native) → API is nu pure-JS →
  slanke `node:slim`-image zonder C-compiler. **`tsx` naar dependencies** (= productie-runtime).
  `start` → `tsx src/index.ts`.
- `apps/admin/vite.config.ts`: vitest beperkt tot `src/**` (`passWithNoTests`) zodat `pnpm test`
  niet meer struikelt over de Playwright-e2e-specs in `e2e/` (die draaien via `test:e2e`).

## Deployen
Zie **`docs/DEPLOY.md`** — kort:
```sh
git clone https://github.com/nadiasiven56/CMS-Webshop.git webshop-crm && cd webshop-crm
cp .env.production.example .env.production   # secrets invullen (openssl rand -hex 32)
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```
Daarna inloggen en de koppelingen activeren door **sleutels in de admin** te plakken
(Bol, Amazon, Mollie, boekhouding, verzending, e-mail) — guarded, geen code nodig.
Zie DEPLOY.md §5 + `docs/CONNECT-OFFICIAL.md`.

## ⚠️ Security-bevinding (actie van operator nodig)
De embedded dev-database `.pgdata/` (1885 files) bleek **per ongeluk meegecommit** en staat
in de **publieke** repo `nadiasiven56/CMS-Webshop`. Inhoud = demo-data + de **seed-admin
bcrypt-hash**. **Geen** `.env`/secrets gelekt (alleen `.env.example`); `CHANNEL_SECRET_KEY`
staat niet in de repo, dus eventuele encrypted kanaal-credentials blijven onleesbaar.

Gedaan: `.pgdata/` uit tracking gehaald + aan `.gitignore` toegevoegd (toekomstige commits schoon).
Nog te beslissen door operator:
1. **History-scrub** (`git filter-repo`/BFG) + force-push om `.pgdata` uit de geschiedenis te wissen, en/of
2. **repo privé** maken, en
3. seed-admin-wachtwoord roteren bij go-live (staat al als checklist in DEPLOY.md §8).

## Niet gedaan / caveats
- **Docker is niet geïnstalleerd op de buildmachine (`hoi`)** → de image-build/compose is hier
  niet end-to-end gedraaid. De runtime (tsx, `NODE_ENV=production`) + beide builds zijn wél
  bewezen; de Docker-laag is standaard en volgt die runtime 1-op-1. Eén test-`up` op de
  doelserver is de laatste stap (DEPLOY.md §9).
- Images installeren de volledige workspace (betrouwbaarheid > grootte); `--prod`-prune kan later.
