/**
 * Serializers — Drizzle-row → API-DTO voor de discounts-module.
 *
 * Conventie (zie shops/_serialize.ts + channels/_serialize.ts):
 *   - timestamps → ISO-string
 *   - numeric (value/minSubtotal/amountApplied) blijft STRING (Money), nooit number
 *   - afgeleide `status` berekenen we hier zodat de UI niet zelf de window/limiet
 *     hoeft te interpreteren.
 */
import type { Discount, DiscountRedemption } from '../../db/schema/discounts.js';

/** Afgeleide levenscyclus-status van een code. */
export type DiscountStatus =
  | 'scheduled' // active, maar startsAt ligt in de toekomst
  | 'active' // bruikbaar nu
  | 'expired' // endsAt is gepasseerd
  | 'exhausted' // maxRedemptions bereikt
  | 'disabled'; // active = false

export interface DiscountDto {
  id: string;
  code: string;
  shopId: string | null;
  type: string;
  value: string;
  currency: string;
  minSubtotal: string | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  maxPerCustomer: number | null;
  timesRedeemed: number;
  active: boolean;
  description: string | null;
  status: DiscountStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Bereken de afgeleide status. Volgorde: disabled > expired > exhausted >
 * scheduled > active. (Een uitgeschakelde code is altijd 'disabled', ongeacht
 * de window.)
 */
export function computeDiscountStatus(d: Discount, now: number = Date.now()): DiscountStatus {
  if (!d.active) return 'disabled';
  if (d.endsAt && d.endsAt.getTime() <= now) return 'expired';
  if (d.maxRedemptions != null && d.timesRedeemed >= d.maxRedemptions) return 'exhausted';
  if (d.startsAt && d.startsAt.getTime() > now) return 'scheduled';
  return 'active';
}

export function toDiscountDto(d: Discount): DiscountDto {
  return {
    id: d.id,
    code: d.code,
    shopId: d.shopId,
    type: d.type,
    value: d.value,
    currency: d.currency,
    minSubtotal: d.minSubtotal,
    startsAt: d.startsAt ? d.startsAt.toISOString() : null,
    endsAt: d.endsAt ? d.endsAt.toISOString() : null,
    maxRedemptions: d.maxRedemptions,
    maxPerCustomer: d.maxPerCustomer,
    timesRedeemed: d.timesRedeemed,
    active: d.active,
    description: d.description,
    status: computeDiscountStatus(d),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

// ─── redemptions ─────────────────────────────────────────────

export interface RedemptionDto {
  id: string;
  discountId: string;
  orderId: string | null;
  customerEmail: string | null;
  amountApplied: string;
  createdAt: string;
}

export function toRedemptionDto(r: DiscountRedemption): RedemptionDto {
  return {
    id: r.id,
    discountId: r.discountId,
    orderId: r.orderId,
    customerEmail: r.customerEmail,
    amountApplied: r.amountApplied,
    createdAt: r.createdAt.toISOString(),
  };
}
