/**
 * Status-pill voor de door de backend AFGELEIDE discount-status
 * (`apps/api/src/routes/discounts/_serialize.ts` → computeDiscountStatus):
 * scheduled | active | expired | exhausted | disabled.
 *
 * De UI berekent de status NIET zelf — ze toont alleen het backend-veld.
 */
import { discountStatusMeta } from './api';

export function DiscountStatusPill({ status }: { status: string }) {
  const m = discountStatusMeta(status);
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}
