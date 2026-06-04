/**
 * Discount-/voucher-domeinlogica — herbruikbaar door de admin-route ÉN de
 * storefront-checkout (de orchestrator wired die laatste later).
 *
 * Twee publieke functies:
 *   - `validateDiscountCode(code, ctx)` — pure read-only check. Throwt NOOIT;
 *     geeft `{ ok:true, ... }` of `{ ok:false, reason, message }` terug. Rekent
 *     in hele centen (integer) via de vat-math-helpers zodat er geen float-drift
 *     in de korting sluipt.
 *   - `recordDiscountRedemption(tx, discountId, { ... })` — tx-aware,
 *     idempotent op (discountId, orderId): schrijft een redemption-rij + bumpt
 *     `discounts.times_redeemed` binnen dezelfde transactie.
 *
 * Geld-conventie: alles wat de DB in/uit gaat is een numeric(12,4)-string
 * (Money); intern rekenen we met `toCents`/`centsToMoney` uit de finance-kern.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import {
  discounts,
  discountRedemptions,
  type Discount,
} from '../../db/schema/discounts.js';
import { toCents, centsToMoney } from '../finance/vat-math.js';
import type { DbOrTx } from '../stock/available-recompute.js';

/** Context die de checkout (of admin-preview) meegeeft om een code te valideren. */
export interface DiscountContext {
  /** Shop waarvoor de code geldt. `null` = globale context (alleen globale codes). */
  shopId: string | null;
  /** Cart-subtotaal in hele centen (excl. verzending). */
  subtotalCents: number;
  /** Valuta van de cart (bv 'EUR'). Moet matchen met de code-valuta. */
  currency: string;
  /** Klant-e-mail — nodig voor de per-klant-limiet. Optioneel. */
  customerEmail?: string | null;
  /** Verzendkosten in hele centen — relevant voor free_shipping-presentatie. */
  shippingCents?: number;
}

/** Resultaat van een geslaagde validatie. */
export interface DiscountValidationOk {
  ok: true;
  discount: Discount;
  /** Toe te passen korting op het subtotaal, in hele centen (>= 0). */
  discountCents: number;
  /** True voor een free_shipping-code (verzending wordt gratis). */
  freeShipping: boolean;
}

/** Resultaat van een gefaalde validatie — nooit een throw. */
export interface DiscountValidationFail {
  ok: false;
  /** Machine-leesbare reden (stabiel; geschikt voor UI-mapping). */
  reason: string;
  /** Mens-leesbare uitleg (NL). */
  message: string;
}

export type DiscountValidationResult = DiscountValidationOk | DiscountValidationFail;

/** Faal-helper — houdt de shape consistent. */
function fail(reason: string, message: string): DiscountValidationFail {
  return { ok: false, reason, message };
}

/**
 * Valideer een discount-code tegen een cart-context. Throwt NOOIT.
 *
 * Volgorde van checks (eerste mis = return):
 *   1. code bestaat (case-insensitive, scope shop OR globaal)
 *   2. active
 *   3. valuta matcht
 *   4. validiteitsvenster (startsAt/endsAt t.o.v. nu)
 *   5. minSubtotal
 *   6. maxRedemptions (times_redeemed < max)
 *   7. maxPerCustomer (#redemptions voor deze e-mail < max)
 * Daarna berekent hij `discountCents`:
 *   - percentage     → round(subtotalCents * value / 100), gecapt op subtotaal
 *   - fixed          → min(valueCents, subtotalCents)
 *   - free_shipping  → discountCents = 0, freeShipping = true
 */
export async function validateDiscountCode(
  code: string,
  ctx: DiscountContext,
): Promise<DiscountValidationResult> {
  const normalized = (code ?? '').trim().toUpperCase();
  if (!normalized) {
    return fail('invalid_code', 'Geen code opgegeven.');
  }

  // Laad codes met deze (genormaliseerde) tekst. We matchen case-insensitive op
  // de opgeslagen UPPERCASE-code en scopen op deze shop OF globaal (shop_id null).
  // Prefereer de shop-specifieke code boven de globale als beide bestaan.
  const candidates = await db
    .select()
    .from(discounts)
    .where(
      and(
        // codes worden UPPERCASE opgeslagen; upper() vangt ook eventuele legacy
        // lowercase-rijen case-insensitive op. Geen ilike: '_' is een geldig
        // code-teken én een ilike-wildcard (zou WEL_COME ~ WELXCOME matchen).
        eq(sql`upper(${discounts.code})`, normalized),
        ctx.shopId
          ? or(eq(discounts.shopId, ctx.shopId), isNull(discounts.shopId))
          : isNull(discounts.shopId),
      ),
    );

  if (candidates.length === 0) {
    return fail('not_found', 'Deze kortingscode bestaat niet.');
  }

  // Shop-specifiek wint van globaal.
  const discount =
    candidates.find((d) => d.shopId === ctx.shopId) ??
    candidates.find((d) => d.shopId === null) ??
    candidates[0]!;

  if (!discount.active) {
    return fail('inactive', 'Deze kortingscode is niet (meer) actief.');
  }

  // Valuta moet matchen — anders zou een EUR-vaste-korting op een andere valuta
  // worden toegepast. Percentage is valuta-onafhankelijk maar we houden de check
  // strikt voor consistentie.
  if (discount.currency && ctx.currency && discount.currency !== ctx.currency) {
    return fail('currency_mismatch', 'Kortingscode geldt niet voor deze valuta.');
  }

  const now = Date.now();
  if (discount.startsAt && discount.startsAt.getTime() > now) {
    return fail('not_started', 'Deze kortingscode is nog niet geldig.');
  }
  if (discount.endsAt && discount.endsAt.getTime() <= now) {
    return fail('expired', 'Deze kortingscode is verlopen.');
  }

  const subtotalCents = Math.max(0, Math.trunc(ctx.subtotalCents));

  if (discount.minSubtotal != null) {
    const minCents = toCents(discount.minSubtotal);
    if (subtotalCents < minCents) {
      return fail(
        'min_subtotal',
        `Besteed minimaal ${centsToMoney(minCents)} om deze code te gebruiken.`,
      );
    }
  }

  if (discount.maxRedemptions != null && discount.timesRedeemed >= discount.maxRedemptions) {
    return fail('exhausted', 'Deze kortingscode is niet meer beschikbaar.');
  }

  if (discount.maxPerCustomer != null) {
    const email = ctx.customerEmail?.trim().toLowerCase();
    if (email) {
      const prior = await db
        .select({ id: discountRedemptions.id })
        .from(discountRedemptions)
        .where(
          and(
            eq(discountRedemptions.discountId, discount.id),
            // case-insensitief, exact (geen ilike-wildcards op '%'/'_' in e-mail).
            eq(sql`lower(${discountRedemptions.customerEmail})`, email),
          ),
        );
      if (prior.length >= discount.maxPerCustomer) {
        return fail(
          'per_customer_limit',
          'Je hebt deze kortingscode al maximaal gebruikt.',
        );
      }
    }
  }

  // ── Korting berekenen (integer centen) ──
  let discountCents = 0;
  let freeShipping = false;

  switch (discount.type) {
    case 'percentage': {
      // value is een percentage (bv 10 => 10%). round-half-away-from-zero.
      const pct = Number(discount.value);
      if (!Number.isFinite(pct) || pct <= 0) {
        discountCents = 0;
      } else {
        discountCents = Math.round((subtotalCents * pct) / 100);
      }
      // Korting kan nooit groter zijn dan het subtotaal.
      discountCents = Math.min(discountCents, subtotalCents);
      break;
    }
    case 'fixed': {
      const valueCents = toCents(discount.value);
      discountCents = Math.min(Math.max(0, valueCents), subtotalCents);
      break;
    }
    case 'free_shipping': {
      discountCents = 0;
      freeShipping = true;
      break;
    }
    default:
      return fail('unsupported_type', 'Onbekend type kortingscode.');
  }

  return { ok: true, discount, discountCents, freeShipping };
}

/** Opties voor {@link recordDiscountRedemption}. */
export interface RecordRedemptionInput {
  /** Order waarop de korting is toegepast (idempotentie-sleutel als gezet). */
  orderId?: string | null;
  /** Klant-e-mail die de code inwisselde (voor de per-klant-limiet). */
  customerEmail?: string | null;
  /** Werkelijk toegepaste korting in hele centen. */
  amountAppliedCents: number;
}

/**
 * Schrijf een redemption-rij + bump `discounts.times_redeemed` — binnen de
 * meegegeven transactie (tx-aware). Idempotent op (discountId, orderId): is er
 * voor dat paar al een rij, dan doet de functie NIETS (geen dubbele bump). Zonder
 * orderId is er geen idempotentie-sleutel en wordt altijd een nieuwe rij gemaakt.
 *
 * Bedoeld om binnen de checkout-transactie te draaien, NA het aanmaken van de
 * order, zodat een rollback ook de redemption terugdraait.
 */
export async function recordDiscountRedemption(
  tx: DbOrTx,
  discountId: string,
  input: RecordRedemptionInput,
): Promise<void> {
  // Idempotentie: als er al een redemption voor (discountId, orderId) bestaat,
  // niets doen. Alleen relevant wanneer er een orderId is.
  if (input.orderId) {
    const existing = await tx
      .select({ id: discountRedemptions.id })
      .from(discountRedemptions)
      .where(
        and(
          eq(discountRedemptions.discountId, discountId),
          eq(discountRedemptions.orderId, input.orderId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return;
    }
  }

  const amountCents = Math.max(0, Math.trunc(input.amountAppliedCents));

  await tx.insert(discountRedemptions).values({
    discountId,
    orderId: input.orderId ?? null,
    customerEmail: input.customerEmail ?? null,
    amountApplied: centsToMoney(amountCents),
  });

  await tx
    .update(discounts)
    .set({
      timesRedeemed: sql`${discounts.timesRedeemed} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(discounts.id, discountId));
}
