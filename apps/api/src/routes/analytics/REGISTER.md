# REGISTER — analytics-module (`/api/analytics/*`)

Read-only business-intelligence endpoints over BESTAANDE tabellen. Geen schema,
geen migratie, geen seed, geen env nodig.

## Wiring (orchestrator/finalizer — `apps/api/src/routes/index.ts`)

Voeg bij de overige feature-imports toe:

```ts
import { analyticsRoutes } from './analytics/index.js';
```

En in het registration-block (bij `apiRoutes.route(...)`):

```ts
apiRoutes.route('/analytics', analyticsRoutes);
```

Dat is alles. De module bevat zelf `requireAuth` op `'*'` (zoals dashboard),
dus mount onder het auth-bereik is niet vereist maar wel consistent.

## Geen schema / seed / env

- **Schema:** geen. Gebruikt alleen bestaande tabellen: `orders`, `order_items`,
  `products`, `variants`, `channels`, `shops`, `customers`, `inventory_items`,
  `inventory_levels`.
- **Migratie:** geen.
- **Seed:** geen.
- **Env:** geen nieuwe variabelen.

## Endpoints (alle achter `requireAuth`)

Gedeelde query-params (zod): `shop_id?` (uuid), `channel?`, `from?` / `to?`
(`YYYY-MM-DD`), `interval?` (`day`|`week`|`month`, default `day`).
Venster default = laatste 30 dagen. Geld = STRING (`'1234.5600'`).

| Method + Path                      | Extra query        | Response (kort)                                                              |
| ---------------------------------- | ------------------ | --------------------------------------------------------------------------- |
| `GET /analytics/sales-over-time`   | —                  | `{ series:[{period,orders,revenue,units}], totals:{...}, interval }`         |
| `GET /analytics/top-products`      | `limit` (1..100=10)| `{ items:[{productId,variantId,title,sku,unitsSold,revenue}] }`              |
| `GET /analytics/kpis`              | —                  | `{ revenue, orders, aov, units, refunds, newCustomers }`                     |
| `GET /analytics/channel-breakdown` | —                  | `{ items:[{channel,orders,revenue,share}] }`                                 |
| `GET /analytics/shop-breakdown`    | —                  | `{ items:[{shopId,shop,orders,revenue,share}] }`                            |
| `GET /analytics/low-stock`         | `threshold` (0=5)  | `{ items:[{productId,variantId,title,sku,available,reorderSuggested}], threshold }` |
| `GET /analytics/customers/top`     | `limit` (1..100=10)| `{ items:[{customerId,email,orders,revenue}] }`                              |

Bad input → `400 { error:'invalid_request', details }`. Lege resultaten → lege
arrays (geen 404).
