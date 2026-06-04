# REGISTER — discounts / vouchers

Module: beheer van kortings-/vouchercodes (percentage / vast bedrag / gratis
verzending) met voorwaarden + een herbruikbare **domein-validatie** die de
storefront-checkout direct kan aanroepen.

Alle nieuwe bestanden (geen bestaande gewijzigd):

- `src/db/schema/discounts.ts` — tabellen `discounts` + `discount_redemptions`
- `src/domain/discounts/validate.ts` — `validateDiscountCode` + `recordDiscountRedemption`
- `src/routes/discounts/{index.ts,_schemas.ts,_serialize.ts}` — `/api/discounts/*`
- `src/db/seed-discounts.ts` — `seedDiscounts()` (idempotent, 2 globale codes)

---

## 1. Mount (orchestrator voegt toe aan `src/routes/index.ts`)

Import (bij de andere route-imports):

```ts
import { discountRoutes } from './discounts/index.js';
```

Mount (in het feature-agent registration slot, naast de andere `apiRoutes.route(...)`):

```ts
apiRoutes.route('/discounts', discountRoutes);
```

Geen verdere wiring nodig. Auth (`requireAuth`) zit al binnen de router
(`discountRoutes.use('*', requireAuth)`). De globale idempotency-middleware op
`/api/*` werkt automatisch mee voor de write-endpoints.

## 2. Schema-export (orchestrator voegt toe aan `src/db/schema/index.ts`)

Eén regel bij de andere `export *`-regels:

```ts
export * from './discounts.js';
```

(De domain- en route-laag importeren rechtstreeks uit `./schema/discounts.js`,
dus deze re-export is alleen nodig voor `db:generate`/centrale toegang.)

## 3. Seed (orchestrator voegt toe aan `src/db/seed.ts`)

Import (bij de andere seed-imports):

```ts
import { seedDiscounts } from './seed-discounts.js';
```

Aanroep in `main()` (na `seedChannels()`):

```ts
await seedDiscounts();
```

Seedt 2 globale codes (`WELKOM10` = 10% percentage, `GRATISVERZENDING` =
free_shipping). Idempotent op (code, shopId) — herhaald draaien voegt niets toe.
Direct los te draaien:
`pnpm --filter @webshop-crm/api exec tsx src/db/seed-discounts.ts`.

## 4. Env vars

**Geen.** Module gebruikt geen nieuwe env-variabelen.

---

## 5. Migration (handgeschreven — volg de 0001/0002-conventie)

Nieuw bestand, bv. `apps/api/drizzle/0006_discounts.sql` (nummer aanpassen aan de
volgende vrije index). Puur additief, `CREATE TABLE IF NOT EXISTS`, hergebruikt de
bestaande `set_updated_at()`-functie (uit 0000). Daarna
`pnpm --filter @webshop-crm/api db:migrate`.

```sql
-- ============================================================
-- Migration 0006 — discounts / vouchers
-- Handgeschreven conform Drizzle-conventie (db:generate kan de ESM-imports niet
-- resolven). PUUR ADDITIEF — bestaande tabellen worden NOOIT aangeraakt.
-- `set_updated_at()` bestaat al uit 0000.
--
-- 2 nieuwe tabellen: discounts, discount_redemptions.
-- ============================================================

-- ─── discounts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "discounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "shop_id" uuid REFERENCES "shops"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "value" numeric(12, 4) DEFAULT '0' NOT NULL,
  "currency" text DEFAULT 'EUR' NOT NULL,
  "min_subtotal" numeric(12, 4),
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "max_redemptions" integer,
  "max_per_customer" integer,
  "times_redeemed" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- UNIQUE(shop_id, code): per shop is een code uniek. NB: Postgres telt NULL als
-- distinct, dus meerdere globale codes met dezelfde tekst worden hier NIET
-- geblokkeerd — de route-laag pre-checkt dat (409 duplicate_code).
ALTER TABLE "discounts"
  ADD CONSTRAINT "discounts_shop_code_unique" UNIQUE ("shop_id", "code");

CREATE INDEX IF NOT EXISTS "discounts_code_idx" ON "discounts" ("code");

-- ─── discount_redemptions (append-only) ──────────────────────
CREATE TABLE IF NOT EXISTS "discount_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "discount_id" uuid NOT NULL REFERENCES "discounts"("id") ON DELETE CASCADE,
  "order_id" uuid,
  "customer_email" text,
  "amount_applied" numeric(12, 4) DEFAULT '0' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "discount_redemptions_discount_idx"
  ON "discount_redemptions" ("discount_id");
CREATE INDEX IF NOT EXISTS "discount_redemptions_order_idx"
  ON "discount_redemptions" ("order_id");

-- ════════════════════════════════════════════════════════════
-- updated_at-trigger (gebruikt bestaande set_updated_at() uit 0000).
-- Alleen `discounts` heeft updated_at; discount_redemptions is append-only.
-- DROP-then-CREATE houdt de migratie herhaalbaar.
-- ════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS discounts_updated_at ON "discounts";
CREATE TRIGGER discounts_updated_at
  BEFORE UPDATE ON "discounts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

> NB: de `ALTER TABLE ... ADD CONSTRAINT` is niet idempotent op oudere Postgres.
> Draai je de migratie mogelijk meerdere keren op dezelfde DB, wikkel hem dan in
> een `DO $$ ... EXCEPTION WHEN duplicate_object THEN null; END $$;`-blok, of
> verplaats de UNIQUE naar de `CREATE TABLE` body. Voor een schone migratie-keten
> (elke migratie 1x) volstaat het bovenstaande.

---

## 6. Endpoints (alle achter `requireAuth`, sessie-cookie)

| Method | Path | Doel |
|---|---|---|
| GET    | `/api/discounts` | list — query: `shop_id` (uuid), `active` (true/false), `q` (code-ilike), `limit` (1..100, def 50), `offset`. Resp `{items, total, limit, offset}` |
| POST   | `/api/discounts` | create — body onder. Code → UPPERCASE. `201 {discount}`. `409 {error:'duplicate_code'}` per scope (shop of globaal). |
| POST   | `/api/discounts/validate` | admin-preview van een code (zie onder). Roept de domein-functie aan; muteert niets. |
| GET    | `/api/discounts/:id` | detail — `200 {discount}` / `404 not_found` / `400 invalid_id` |
| PATCH  | `/api/discounts/:id` | partial update (alle velden + `active`, min. 1). `409 duplicate_code` bij code/shop-wissel. |
| DELETE | `/api/discounts/:id` | verwijder (cascade ruimt `discount_redemptions`). `200 {ok, id}` |
| GET    | `/api/discounts/:id/redemptions` | append-only redemption-log. Query: `limit`, `offset`. Resp `{discountId, items, total, limit, offset}` |

**Create-body** (`POST /api/discounts`):
```jsonc
{
  "code": "WELKOM10",            // verplicht; [A-Za-z0-9._-], 1..64, → UPPERCASE
  "type": "percentage",          // "percentage" | "fixed" | "free_shipping"
  "value": "10.0000",            // money-string; verplicht voor percentage/fixed; genegeerd voor free_shipping
  "shopId": null,                // uuid of null (globaal). optioneel
  "currency": "EUR",             // optioneel (default EUR)
  "minSubtotal": "50.0000",      // money-string of null, optioneel
  "startsAt": "2026-06-01T00:00:00Z",  // ISO of null, optioneel
  "endsAt":   "2026-12-31T23:59:59Z",  // ISO of null, optioneel (> startsAt)
  "maxRedemptions": 100,         // int >=1 of null, optioneel
  "maxPerCustomer": 1,           // int >=1 of null, optioneel
  "active": true,                // optioneel (default true)
  "description": "..."           // optioneel
}
```

**Validate-body** (`POST /api/discounts/validate`):
```jsonc
{
  "code": "WELKOM10",            // verplicht
  "shop_id": null,               // uuid of null, optioneel
  "subtotal": "100.0000",        // money-string, verplicht
  "currency": "EUR",             // optioneel (default EUR)
  "customer_email": "a@b.nl",    // optioneel (voor per-klant-limiet)
  "shipping": "5.9500"           // money-string, optioneel
}
```
Respons (geldig):
`{ valid:true, discountId, code, type, discountCents, discount:"10.0000", freeShipping, currency }`.
Respons (ongeldig): `{ valid:false, reason, message }` (200 — het is een preview, geen fout).

**Geld**: `value`, `minSubtotal`, `amountApplied` zijn numeric(12,4)-**strings**
(Money-conventie), nooit number — in & uit. Intern rekent de domein-laag in hele
centen via `domain/finance/vat-math.ts`.

**Audit**: alle writes (create/update/delete discount) lopen via
`runInTransactionWithAudit` → `audit_log`-rij met `entityType` `discount`.

---

## 7. Publieke domein-functies (voor de storefront-checkout wiring)

Bestand: `apps/api/src/domain/discounts/validate.ts`. De orchestrator wired deze
later in `routes/storefront/checkout.ts` (READ-ONLY voor mij gebleven). Beide
functies throwen NOOIT op een normale miss.

```ts
import {
  validateDiscountCode,
  recordDiscountRedemption,
  type DiscountContext,
} from '../../domain/discounts/validate.js';

// 1) Valideren (read-only, nooit throw):
export interface DiscountContext {
  shopId: string | null;     // shop.id van de cart, of null voor globale context
  subtotalCents: number;     // cart-subtotaal in HELE CENTEN (excl. verzending)
  currency: string;          // 'EUR'
  customerEmail?: string | null;
  shippingCents?: number;    // verzending in centen (free_shipping-presentatie)
}

validateDiscountCode(code: string, ctx: DiscountContext): Promise<
  | { ok: true; discount: Discount; discountCents: number; freeShipping: boolean }
  | { ok: false; reason: string; message: string }
>

// 2) Inwisselen (binnen de checkout-transactie, NA het aanmaken van de order):
recordDiscountRedemption(
  tx: DbOrTx,            // de drizzle-tx uit runInTransactionWithAudit
  discountId: string,
  input: { orderId?: string | null; customerEmail?: string | null; amountAppliedCents: number },
): Promise<void>
// Idempotent op (discountId, orderId): is er voor dat paar al een rij, dan NIETS
// (geen dubbele times_redeemed-bump). Bumpt anders times_redeemed + schrijft een
// discount_redemptions-rij — alles binnen de meegegeven tx.
```

### Checkout-integratie (schets voor de orchestrator)

`checkout.ts` rekent het cart-subtotaal al uit (`subtotal`, een Money-string) en
draait binnen `runInTransactionWithAudit`. Wiring-stappen:

1. Lees een optionele `discountCode` uit de checkout-body (schema-uitbreiding).
2. VÓÓR/bij de totalenberekening:
   `const res = await validateDiscountCode(discountCode, { shopId: shop.id, subtotalCents: toCents(subtotal), currency: shop.currency, customerEmail: input.email });`
   (gebruik `toCents` uit `domain/finance/vat-math.ts`).
3. Bij `res.ok`: trek `res.discountCents` van het subtotaal af bij het bepalen van
   `grandTotal` (= subtotal − discount + shipping), en zet `shippingTotal = 0` als
   `res.freeShipping`. Schrijf het kortingsbedrag naar `orders.discount_total`
   (kolom bestaat al, `numeric(12,4)` default '0') via `centsToMoney(res.discountCents)`.
4. NA het aanmaken van de order, binnen dezelfde `tx`:
   `await recordDiscountRedemption(tx, res.discount.id, { orderId: order.id, customerEmail: input.email, amountAppliedCents: res.discountCents });`
5. Bij `!res.ok`: óf de code negeren (geen korting) óf de checkout met
   `{ error:'invalid_discount', reason: res.reason }` afwijzen — productkeuze van
   de orchestrator.

Free_shipping levert `discountCents = 0` + `freeShipping = true` op; het effect
zit in het op 0 zetten van `shippingTotal`, niet in `discount_total`.

---

## 8. Patterns bevestigd

- Route/error/audit-patroon exact als `channels/index.ts` (zelfde `ip()`-helper,
  `runInTransactionWithAudit`, `invalid_id`/`not_found`/`invalid_request`).
- Shop-FK + `onDelete:'cascade'` + `numeric(12,4)` Money-conventie als
  `channel-products.ts` / `shops.ts`.
- Money: string in DB + API, integer-cents in math (`toCents`/`centsToMoney`).
- Seed idempotent als `seed-channels.ts` (per-key existence-check, CLI-direct-run guard).
- ESM `.js`-imports overal.
```
