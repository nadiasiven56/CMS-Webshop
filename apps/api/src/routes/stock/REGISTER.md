# REGISTER.md — stock-agent route-registratie

**Voor de finalizer**: voeg de volgende regels toe aan
`apps/api/src/routes/index.ts` op de gemarkeerde slot.

## 1. Imports (boven `export const apiRoutes`)

```ts
import { stockRoutes } from './stock/index.js';
import { movementsRoutes } from './movements/index.js';
```

## 2. Route-registratie (op de "Feature-agent registration slot")

```ts
apiRoutes.route('/stock', stockRoutes);
apiRoutes.route('/movements', movementsRoutes);
```

## Resulterende endpoints

- `GET    /api/stock`                — overview (paginated, filter+sort+lowStockOnly)
- `GET    /api/stock/:itemId`        — detail met per-location breakdown + 10 recente movements
- `POST   /api/stock/:itemId/adjust` — handmatige stock-adjustment (transactional, audit-logged)
- `GET    /api/movements`            — paginated movements-log (filter op item/location/date/reason)

Alle endpoints zijn achter `requireAuth`. POST `/adjust` accepteert `?force=true`
als operator-override voor "negatief on_hand toegestaan" (default: 422 bij negatief).

## Geen schema-wijzigingen

Stock-agent heeft GEEN nieuwe schema-files toegevoegd. Alle 5 inventory-tabellen +
`locations` + `audit_log` waren al door foundation aangemaakt. Geen
`pnpm db:generate` nodig.
