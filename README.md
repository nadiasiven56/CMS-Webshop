# Webshop-CRM

Custom multi-shop CRM/ERP-platform — één centraal systeem achter N eigen webshops + N marketplace-channels (Bol, Amazon, Google Shopping), met gedeelde voorraad, eigen ledger en uitgebreidbare adapter-architectuur.

**Owner**: Atlas (agent1)
**Status**: Fase 1 — foundation in opbouw

## Quick start (development)

> Volledige instructies (incl. troubleshooting) komen in `docs/DEV-SETUP.md` na de finalize-pass.

```sh
# 1. Database + Redis (Docker Desktop moet draaien)
pnpm db:up

# 2. Dependencies (root + alle workspaces)
pnpm install

# 3. Environment
cp .env.example .env
# bewerk .env — minstens SESSION_SECRET en CHANNEL_SECRET_KEY zetten

# 4. Schema migreren + seed
pnpm db:migrate
pnpm db:seed

# 5. Dev-servers (parallel)
pnpm dev
# → API:   http://localhost:7300/health
# → Admin: http://localhost:7301
```

## Repo-layout

```
webshop-crm/
├── apps/
│   ├── api/                 # Hono backend (Node 22 + Drizzle + Lucia)
│   └── admin/               # TanStack Router + Vite frontend (AI Centrum-thema)
├── packages/
│   └── shared/              # zod-schemas, types, gedeeld tussen api ↔ admin
├── docs/                    # VISION/ARCHITECTURE/V1-ROADMAP/DB-SCHEMA
├── docker-compose.dev.yml   # Postgres 16 + Redis 7 lokaal
├── INTEGRATION.md           # contract voor parallel feature-agents
└── DECISIONS.md             # architectuur-/scope-keuzes log
```

## Documenten

- [`docs/VISION.md`](docs/VISION.md) — wat & waarom
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — tech-stack, deployment, API-contracten
- [`docs/V1-ROADMAP.md`](docs/V1-ROADMAP.md) — 5 fasen (foundation → channels → ledger → polish)
- [`docs/DB-SCHEMA.md`](docs/DB-SCHEMA.md) — canonical Postgres-model
- [`DECISIONS.md`](DECISIONS.md) — operator-keuzes & autonome beslissingen
- [`INTEGRATION.md`](INTEGRATION.md) — folder-eigendom + extensie-contract per feature-agent
- [`FASE-1-FOUNDATION-SUMMARY.md`](FASE-1-FOUNDATION-SUMMARY.md) — wat klaar is in deze fase

## Gerelateerde projecten (siblings)

- `../webshop-crm-research/REQUIREMENTS.md` — research-rapport (Bol/Amazon/GMC/BTW/multi-warehouse)
- `../[Aether's webshop-template/]` — herbruikbare Next.js storefront-templates die straks via API-contract uit deze CRM eten

## Stack-keuzes

| Laag | Keuze |
|---|---|
| Database | Postgres 16 (lokaal via Docker) |
| ORM | Drizzle |
| Backend | Node 22 + Hono + TypeScript (strict) |
| Auth | Lucia (sessie-cookies) + bcrypt + token-tabel |
| Background | BullMQ + Redis (vanaf Fase 2/3) |
| Admin UI | React 19 + TanStack Router + Vite + AI Centrum-thema |
| Storage V1 | Local filesystem (`storage/`) |
| Tunnel | cloudflared (named tunnel voor stabiele webhook-URL) |

Volledige rationales in `docs/ARCHITECTURE.md`.

## License

Proprietary — operator-only. Niet voor publicatie zonder operator-akkoord.
