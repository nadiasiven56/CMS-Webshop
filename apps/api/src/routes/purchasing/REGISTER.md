# REGISTER — purchasing (Agent 5)

Inkoop-module: suppliers + purchase-orders + ontvangst (receive) met
stock-movements. Alle routes achter `requireAuth`. Geld = string, `inArray()`
i.p.v. `ANY()`, writes via `runInTransactionWithAudit`.

## Mount (Atlas voegt toe aan `apps/api/src/routes/index.ts`)

Import-sectie:

```ts
import { purchasingRoutes } from './purchasing/index.js';
```

Registration-slot (onder de bestaande feature-mounts):

```ts
// purchasing-agent (Wave 1):
apiRoutes.route('/purchasing', purchasingRoutes);
```

## Endpoints (alle achter `requireAuth`, prefix `/api/purchasing`)

### Suppliers
| Method | Path | Beschrijving |
|---|---|---|
| GET | `/suppliers` | list — query: `limit`,`offset`,`search`,`active` |
| POST | `/suppliers` | create → 201 `{ supplier }` |
| GET | `/suppliers/:id` | detail |
| PATCH | `/suppliers/:id` | partial update |
| DELETE | `/suppliers/:id` | soft-delete (`active=false`); `?hard=true` = echte delete (409 als PO's verwijzen) |

### Purchase-orders
| Method | Path | Beschrijving |
|---|---|---|
| GET | `/po` | list — query: `limit`,`offset`,`status`,`supplierId` (incl. `itemCount`) |
| POST | `/po` | create incl. `items[]` → berekent `subtotal`/`taxTotal`/`total` (optioneel `taxRate` %) → 201 |
| GET | `/po/:id` | detail incl. items (met `quantityOutstanding` + `lineTotal`) |
| PATCH | `/po/:id` | update header + status-transitie; `items[]` vervangen mag alleen bij status `draft` |
| DELETE | `/po/:id` | verwijderen — alleen `draft` of `cancelled` (anders 409) |
| POST | `/po/:id/receive` | ontvangst — zie hieronder |

**Status-machine**: `draft → ordered → partial → received` / `… → cancelled`.
`received` en `cancelled` zijn terminal. `partial`/`received` worden door
`/receive` automatisch gezet; handmatige transities via PATCH zijn 409-gevalideerd.

### Receive — `POST /api/purchasing/po/:id/receive`
Body:
```json
{ "locationId": "<uuid|optioneel>", "note": "<optioneel>",
  "lines": [ { "itemId": "<purchase_order_item.id>", "quantity": 2 } ] }
```
Gedrag (1 transactie via `runInTransactionWithAudit`):
- valideert per line: PO-item bestaat, niet over-ontvangen (422 `over_receive`)
- verhoogt `purchase_order_items.quantity_received`
- per ontvangen variant: `applyDeltaAndRecompute` (+delta op de PO/override-location)
  + een `inventory_movements`-row (`reason='po_receive'`, `ref_type='po'`,
  `ref_id=po.id`, `delta=+qty`). Lines zonder gekoppelde `inventory_item`
  (variant zonder item) updaten alleen `quantity_received`, geen stock-movement.
- herberekent PO-status → `partial` (deels) of `received` (alles binnen) + `received_at`
- `locationId` valt terug op `po.location_id`; ontbreekt beide → 422 `location_required`
- schrijft 1 audit-row (`action='receive'`, `entity_type='purchase_order'`)

Foutcodes: 400 `invalid_request` · 404 `not_found`/`po_item_not_found`/`location_not_found`
· 409 `po_cancelled`/`po_already_received`/`invalid_status_transition`/`items_locked`/`delete_not_allowed`/`supplier_in_use`
· 422 `over_receive`/`location_inactive`/`location_required`/`negative_stock`.

## Schema-verzoeken (indien kolom mist)
**Geen.** Module gebruikt uitsluitend bestaande, bevroren tabellen:
`suppliers`, `purchase_orders`, `purchase_order_items`, plus read/write op de
foundation-tabellen `variants`, `inventory_items`, `inventory_levels`,
`inventory_movements`, `locations`, `audit_log` (via de stock-helpers).

Opmerking: `purchase_order_items` heeft geen eigen `unit_price`/`tax`-kolommen;
PO-totalen worden berekend uit `quantity * unit_cost` + optionele `taxRate`
(request-param, niet opgeslagen per regel). Geen schema-change nodig — als je
later per-regel BTW wilt persisteren, vraag dan een `tax_rate`-kolom aan op
`purchase_order_items`.

## Seed/env-verzoeken
**Geen.** Werkt op de bestaande DB. (Voor demo-data zou een
`seed-suppliers`/`seed-po` later kunnen, maar is niet vereist voor Wave 1.)

## Tests
- `src/routes/purchasing/__tests__/purchasing.receive.test.ts` — **REAL-DB**
  integration via Hono `app.request()`. Mockt alleen `requireAuth`; alle
  db-operaties gaan naar de echte PostgreSQL (:7432) en worden in `afterAll`
  opgeruimd (on_hand wordt exact teruggezet). Dekt: supplier-list, PO-create
  met berekende totals, partiële receive (→ partial, +movement, on_hand +2),
  volledige receive (→ received, 2 movements, on_hand +5), over-receive/409,
  invalid body/400.

Draaien:
```sh
pnpm -C "C:\ClaudeAgents\shared\from-agent1\webshop-crm" --filter @webshop-crm/api test
# of alleen deze module:
pnpm --filter @webshop-crm/api exec vitest run src/routes/purchasing
```
Resultaat bij oplevering: **6/6 PASS** tegen de live DB; DB blijft schoon achter.

## Verificatie / smoke (curl, na mount + login-cookie)
```sh
# supplier
curl -b cookies.txt -X POST http://localhost:7300/api/purchasing/suppliers \
  -H 'content-type: application/json' -d '{"name":"Acme BV"}'
# PO (vervang <sup>,<loc>,<variant>)
curl -b cookies.txt -X POST http://localhost:7300/api/purchasing/po \
  -H 'content-type: application/json' \
  -d '{"supplierId":"<sup>","locationId":"<loc>","taxRate":21,
       "items":[{"variantId":"<variant>","quantity":5,"unitCost":"10.0000"}]}'
# receive (vervang <po>,<poItem>)
curl -b cookies.txt -X POST http://localhost:7300/api/purchasing/po/<po>/receive \
  -H 'content-type: application/json' \
  -d '{"lines":[{"itemId":"<poItem>","quantity":2}]}'
```
```
