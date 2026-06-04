/**
 * Order-status state-machine. Pure logica (geen DB) zodat unit-testbaar.
 *
 * Hoofd-status (`orders.status`):
 *   pending → paid → fulfilled → shipped → delivered
 * Plus terminale/uitzonderings-overgangen: cancelled, refunded.
 *
 * `financial_status` en `fulfillment_status` worden afgeleid van de
 * hoofd-status zodat de drie velden consistent blijven.
 */

export const ORDER_STATUSES = [
  'pending',
  'paid',
  'fulfilled',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Toegestane voorwaartse/zijwaartse overgangen per status. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['fulfilled', 'shipped', 'cancelled', 'refunded'],
  fulfilled: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [], // terminaal
  refunded: [], // terminaal
};

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNextStatuses(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

/**
 * Afgeleide financial/fulfillment-status bij een hoofd-status-overgang.
 * Bewust conservatief: alleen zetten wat logisch volgt uit de status.
 */
export function derivedStatuses(to: OrderStatus): {
  financialStatus?: string;
  fulfillmentStatus?: string;
} {
  switch (to) {
    case 'paid':
      return { financialStatus: 'paid' };
    case 'fulfilled':
      return { fulfillmentStatus: 'fulfilled' };
    case 'shipped':
      return { fulfillmentStatus: 'shipped' };
    case 'delivered':
      return { fulfillmentStatus: 'delivered' };
    case 'refunded':
      return { financialStatus: 'refunded' };
    case 'cancelled':
      return {};
    default:
      return {};
  }
}

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
}
