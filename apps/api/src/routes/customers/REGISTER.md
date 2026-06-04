# REGISTER — customers (Agent 4)

Registratie-instructie voor de finalizer (Atlas). Wire dit atomair in
`apps/api/src/routes/index.ts`. Verder NIETS aanraken buiten `routes/customers/`.

## Mount (Atlas voegt toe aan routes/index.ts)

Import (bij de andere feature-imports):

```ts
import { customersRoutes } from './customers/index.js';
```

Mount (in het feature-agent registration slot):

```ts
apiRoutes.route('/customers', customersRoutes);
```

> Hele module zit achter `requireAuth` (cookie-sessie) via
> `customersRoutes.use('*', requireAuth)` in `customers/index.ts`. Geen extra
> middleware nodig. Geen idempotency-vereisten (writes zijn niet financieel).

## Endpoints

Alle paden onder `/api/customers`, alles achter `requireAuth`, shop-scoped.

| Method | Path | Omschrijving |
|---|---|---|
| GET | `/api/customers` | List + filter `shopId` (uuid) + `search` (ilike email/first_name/last_name/company) + `limit` (1..100, def 20) + `offset`. → `{ items, total, limit, offset }` |
| POST | `/api/customers` | Create. Body: `shopId`+`email` verplicht; `firstName/lastName/phone/company/vatNumber/acceptsMarketing/tags/notes` optioneel. → 201 `{ customer }`. 404 `shop_not_found`, 409 `email_taken` (UNIQUE(shop_id,email)). |
| GET | `/api/customers/:id` | Detail incl. adressen. → `{ customer, addresses }`. 404 `not_found`. |
| PATCH | `/api/customers/:id` | Partial update (≥1 veld). `shop_id` verandert niet. → `{ customer }`. 409 `email_taken` bij email-rename-clash. |
| DELETE | `/api/customers/:id` | Hard-delete (addresses cascade, orders.customer_id → set null). → `{ deleted, id }`. 404 `not_found`. |
| GET | `/api/customers/:id/addresses` | Adres-lijst. → `{ addresses }`. |
| POST | `/api/customers/:id/addresses` | Adres-create. `type` (`billing`\|`shipping`) verplicht, `isDefault` optioneel. Zetten van `isDefault` unset andere defaults van hetzelfde type (transactie). `country` wordt ge-uppercased naar ISO-2. → 201 `{ address }`. |
| PATCH | `/api/customers/:id/addresses/:addressId` | Adres-update (scoped op klant; 404 als adres niet bij die klant hoort). → `{ address }`. |
| DELETE | `/api/customers/:id/addresses/:addressId` | Adres-delete (scoped op klant). → `{ deleted, id }`. |
| GET | `/api/customers/:id/orders` | **Read-only** order-historie. Enkel een `select` op `orders` (filter `customer_id`), gesorteerd `created_at desc`, `limit`/`offset`. Dupliceert orders-routes NIET. → `{ items, total, limit, offset }`. |

Conventies: `inArray()` i.p.v. `ANY()` (n.v.t. hier — geen array-filters nodig);
geld = string (`total_spent`, `grand_total` blijven string); timestamps → ISO.
Fout-shape `400 { error:'invalid_request', details }` bij zod-fout (zoals products).

## Schema-verzoeken (indien kolom mist)

Geen. De module gebruikt uitsluitend de bevroren tabellen `customers`,
`customer_addresses` (write) en `orders` (read-only select). Geen kolommen toegevoegd.

Opmerking voor later (GEEN actie nu): `customers.orders_count` /
`customers.total_spent` zijn denormalized aggregaten. Deze module schrijft ze
NIET bij — dat hoort bij de orders-feature (Agent 3) op order-create/refund.
Ze worden hier alleen read-only geserveerd.

## Seed/env-verzoeken

Geen.

## Tests

`src/routes/customers/__tests__/customers.test.ts` — vitest tegen de **ECHTE**
Postgres (`:7432`). Maakt een wegwerp-shop + klant + adressen aan via Hono
`app.request()`, leest terug, test happy/error/conflict-paden (incl. 409
email_taken en default-address-unset), en ruimt alles op in `afterAll`
(cascade + expliciete shop-delete). `requireAuth` is ge-mockt (no-op + fake
admin) zodat er geen sessie-cookie nodig is; de DB-laag is wat getest wordt.

Draaien:

```sh
pnpm -C "C:\ClaudeAgents\shared\from-agent1\webshop-crm" --filter @webshop-crm/api test -- src/routes/customers
```

Resultaat bij oplevering: **19/19 PASS**, 0 leftover-rows na cleanup.

## Verificatie (na mount)

```sh
# Login → cookie
curl -s -c /tmp/c.txt -X POST http://127.0.0.1:7300/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@webshop-crm.local","password":"admin12345"}'

# List (leeg = ok)
curl -s -b /tmp/c.txt 'http://127.0.0.1:7300/api/customers?limit=5'
```
