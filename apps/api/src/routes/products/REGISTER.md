# Product-routes — registratie-instructie voor finalizer

Deze file bevat **de exacte regels** die de finalizer (Atlas of een merge-
agent) moet toevoegen aan `apps/api/src/routes/index.ts` om de
product-feature te activeren.

## Wat doe je

Open `apps/api/src/routes/index.ts` en pas exact 2 dingen aan:

### 1. Activeer de import (uncomment de bestaande regel)

In de import-sectie staat al:

```ts
// import { productRoutes } from './products/index.js';   // <- product-agent
```

Maak hier van:

```ts
import { productRoutes } from './products/index.js';
```

### 2. Activeer de route-mount (uncomment de bestaande regel)

In de "Feature-agent registration slot" comment-block staat al:

```ts
// product-agent (Fase 1, ronde 2):
//   apiRoutes.route('/products', productRoutes);
```

Voeg hieronder toe:

```ts
apiRoutes.route('/products', productRoutes);
```

(Je kunt de comment-regel laten staan; de actieve regel hoort er los onder.)

## Concreet — full diff (ter referentie)

Voor:

```ts
// import { productRoutes } from './products/index.js';   // <- product-agent
...
apiRoutes.route('/auth', authRoutes);

// ─── Feature-agent registration slot ─────────────────────────
// product-agent (Fase 1, ronde 2):
//   apiRoutes.route('/products', productRoutes);
```

Na:

```ts
import { productRoutes } from './products/index.js';
...
apiRoutes.route('/auth', authRoutes);

// ─── Feature-agent registration slot ─────────────────────────
// product-agent (Fase 1, ronde 2):
apiRoutes.route('/products', productRoutes);
```

## Vereisten / dependencies

- `@webshop-crm/shared` dependency in `apps/api/package.json` (al toegevoegd
  door product-agent — workspace-protocol).
- Geen nieuwe schema-files (product-agent gebruikt alleen foundation-tables).
- Geen nieuwe drizzle-migration nodig.
- Idempotency-middleware staat al global op `/api/*` — geen extra werk.
- Audit-log gebruikt bestaande `audit_log`-tabel uit foundation.

## Verificatie

Na de 2 regels actief gemaakt te hebben:

```sh
pnpm --filter @webshop-crm/api typecheck   # moet groen zijn
pnpm --filter @webshop-crm/api test         # vitest GROEN
pnpm --filter @webshop-crm/api dev          # API boot, zie /api/products in logs
```

Smoke-test:

```sh
# Login eerst om sessie-cookie te krijgen
curl -i -c /tmp/cookies.txt -X POST http://localhost:7300/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@webshop-crm.local","password":"<seed-password>"}'

# List
curl -b /tmp/cookies.txt http://localhost:7300/api/products

# Create
curl -b /tmp/cookies.txt -X POST http://localhost:7300/api/products \
  -H 'content-type: application/json' \
  -H 'idempotency-key: test-1' \
  -d '{"title":"Test product"}'
```
