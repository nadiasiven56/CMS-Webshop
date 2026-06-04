# REGISTER — orders (Agent 3)

Module: `apps/api/src/routes/orders/` (+ pure helpers in `apps/api/src/domain/orders/`).
Status: routes geschreven, tsx-watch herlaadt zonder crash, vitest E2E tegen echte DB = 19/19 groen, cleanup laat 0 rijen achter.

## Mount (Atlas voegt toe aan `apps/api/src/routes/index.ts`)

Twee routers — let op: er zijn TWEE mount-regels (orders + top-level returns/RMA-board).

```ts
import { ordersRoutes, returnsRoutes } from './orders/index.js';

apiRoutes.route('/orders', ordersRoutes);
apiRoutes.route('/returns', returnsRoutes);
```

(De `returns`-router serveert het RMA-board los van een order. De order-geneste
return-endpoints zitten al ín `ordersRoutes`.)

## Endpoints

Alle achter `requireAuth` (admin, cookie-sessie). Shop-scoping via `shop_id`-query/param.

| Method | Path | Doel |
|---|---|---|
| GET | `/api/orders` | list — filters: `shop_id`, `status`, `financial_status`, `fulfillment_status`, `channel`, `search` (order_number/email), `limit`, `offset`. Response items = order-core + `itemCount` + `customerName`. |
| POST | `/api/orders` | create — genereert per-shop `order_number` (bv `CR-1001`), berekent per item tax_amount/line_total + order subtotal/tax_total/grand_total + marge. Body: `{shopId, customerId?, email?, channel?, currency?, items[], shippingTotal?, discountTotal?, billingAddress?, shippingAddress?, note?, placed?}`. Item: `{variantId?, sku?, title?, quantity, unitPrice, taxRate?='21', costPrice?}`. |
| GET | `/api/orders/:id` | detail — items (incl. `margin`/`marginPct` per regel uit `cost_price`), payments, fulfillments, returns(+items), customer-snapshot, order-`margin`/`marginPct`. |
| PATCH | `/api/orders/:id/status` | status-transitie via state-machine. Body `{status, note?}`. Geldig: pending→paid→fulfilled→shipped→delivered, + cancelled/refunded. Zet afgeleide financial/fulfillment-status. 409 `invalid_transition` met `allowed[]`. |
| GET | `/api/orders/:id/fulfillments` | list fulfillments. |
| POST | `/api/orders/:id/fulfillments` | create fulfillment. Body `{locationId?, carrier?, trackingCode?, trackingUrl?, status?='shipped', markShipped?}`. Zet `fulfillment_status`; promoot order naar `shipped` bij status shipped/delivered (tenzij markShipped=false). |
| GET | `/api/orders/:id/payments` | list payments. |
| POST | `/api/orders/:id/payments` | create payment. Body `{provider?='mock', amount, status?='paid', reference?, markPaid?}`. Herberekent `financial_status` (som paid-payments ≥ grand_total → 'paid'); promoot pending-order naar 'paid'. |
| GET | `/api/orders/:id/returns` | list returns voor order. |
| POST | `/api/orders/:id/returns` | create RMA voor order (shop_id afgeleid uit order). Body `{reason?, refundAmount?, status?='requested', items[]}`. Item: `{orderItemId?, quantity?, restock?=true}`. |
| GET | `/api/returns` | RMA-board — filters `shop_id`, `order_id`, `status`, `limit`, `offset`. |
| POST | `/api/returns` | create RMA top-level (`shopId` of `orderId` verplicht). |
| GET | `/api/returns/:rid` | detail (+items). |
| PATCH | `/api/returns/:rid` | update `{status?, reason?, refundAmount?}`. |

## Geld / conventies

- Alle bedragen = string (`numeric(12,4)`), berekend via `@webshop-crm/shared/types/money`. Geen float.
- `inArray()` gebruikt (geen `ANY()`).
- Writes lopen door `runInTransactionWithAudit` (audit-rows: entityType `order` met action `create`/`update`/`ship`, en `return` met `create`/`update`).
- Serializers in `_serialize.ts` (timestamps → ISO, numeric blijft string).

## Schema-verzoeken (indien kolom mist)

**Geen.** Alle benodigde kolommen bestaan al in `orders`, `order_items`, `order_payments`, `order_fulfillments`, `returns`, `return_items`.

Twee observaties (geen blocker, alleen ter info voor Atlas):
1. `orders.customer_id` denormalisatie (`customers.orders_count` / `total_spent`) wordt door deze module NIET bijgewerkt — dat hoort bij de customers-agent (Agent 4) of een latere hook. Niet in scope hier.
2. Fulfillment doet (nog) geen stock-decrement. Voorraad-koppeling (committed→on_hand release) is bewust buiten Wave-1-orders gelaten; kan later via `applyDeltaAndRecompute` in dezelfde transactie. Documenteer als open punt.

## Seed/env-verzoeken

**Geen.** De E2E-test seedt z'n eigen test-shop/variant/customer en ruimt op. Geen permanente seed nodig.

## Tests

- `apps/api/src/routes/orders/__tests__/orders.test.ts` — vitest, **echte DB** (geen mocks).
  - Pure unit: `computeLine`, `computeOrderTotals`, `computeOrderMargin`, `orderNumberPrefix`, status-machine.
  - E2E: 401-zonder-auth, 400-invalid, create (order_number/totalen/marge), sequentie order_number, list, detail (regel-marge + order-marge), 404, status-transitie (geldig 200 + ongeldig 409), payment, fulfillment (promoot naar shipped), RMA-create, returns-board filter.
- Draaien:
  ```
  pnpm -C "C:\ClaudeAgents\shared\from-agent1\webshop-crm" --filter @webshop-crm/api test
  ```
  of gericht:
  ```
  pnpm --filter @webshop-crm/api exec vitest run src/routes/orders/__tests__/orders.test.ts
  ```
  Resultaat bij oplevering: **19/19 passed**, 0 leftover-rijen na cleanup.

## Bestanden in deze module

```
routes/orders/
  index.ts            — beide routers (ordersRoutes, returnsRoutes)
  list.ts get.ts create.ts status.ts fulfillments.ts payments.ts returns.ts
  _serialize.ts _schemas.ts
  __tests__/orders.test.ts
  REGISTER.md
domain/orders/
  order-math.ts       — computeLine / computeOrderTotals / computeOrderMargin
  order-number.ts     — per-shop oplopend order_number (prefix uit slug)
  status-machine.ts   — geldige status-transities + afgeleide statussen
```
