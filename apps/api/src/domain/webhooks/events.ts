/**
 * Webhook-event-catalogus.
 *
 * De canonieke lijst van domein-events waarop een outbound webhook geabonneerd
 * kan zijn. Het naam-formaat is `<category>.<action>` (bv. `order.created`),
 * exact zoals de bestaande `/admin/webhooks`-CRUD het `event`-veld vult. De
 * `<category>`-prefix correspondeert met de grove `scope`-enum van de webhooks-
 * tabel (`order` | `channel` | `all`) plus de extra categorieën die hier
 * geintroduceerd worden (`return`, `product`, `stock`). Zie {@link eventCategory}.
 *
 * Het admin-UI kan deze lijst via `GET /api/webhooks/events` ophalen om een
 * dropdown te vullen.
 */
export const WEBHOOK_EVENTS = [
  'order.created',
  'order.paid',
  'order.fulfilled',
  'order.cancelled',
  'return.created',
  'return.received',
  'product.created',
  'product.updated',
  'stock.low',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Generieke envelope die naar de geabonneerde endpoint verstuurd wordt. De
 * dispatcher serialiseert dit stabiel (gesorteerde keys) zodat de HMAC-signature
 * deterministisch is.
 */
export interface WebhookEventPayload {
  event: WebhookEvent;
  /** ISO-8601 tijdstip waarop het domein-event plaatsvond. */
  occurredAt: string;
  data: Record<string, unknown>;
}

/** Type-guard: hoort `value` bij de bekende event-catalogus? */
export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/**
 * Grove categorie van een event = het deel vóór de eerste punt. Bv.
 * `order.created` → `order`. Wordt gebruikt om de webhooks-`scope`-enum
 * (`order` | `channel` | `all`) tegen het event te matchen.
 */
export function eventCategory(event: string): string {
  const dot = event.indexOf('.');
  return dot === -1 ? event : event.slice(0, dot);
}
