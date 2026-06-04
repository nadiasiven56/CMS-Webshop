/**
 * Order-event orchestratie — koppelt de bestaande domein-flows (orders/returns/
 * checkout) aan de koppel-klaar side-effect-services (e-mail, webhooks, reviews).
 *
 * WAAROM EEN APARTE LAAG:
 *   De route-handlers vuren bij een echte state-change (paid/shipped/cancelled/
 *   return) een handvol side-effects af. Die services zijn allemaal NEVER-THROW
 *   gebouwd, maar we wrappen ze hier NÓG een keer defensief zodat:
 *     - een onverwachte programmeerfout in een service de request niet breekt;
 *     - de aanroep-site één regel blijft (`void fireOrderPaid(...)`);
 *     - we de fire-and-forget-discipline op één plek bewaken.
 *
 * GARANTIE: elke `fire*`-functie is `async` maar resolved ALTIJD (nooit reject).
 * De aanroeper gebruikt `void fireX(...)` — de Promise wordt bewust niet
 * geawait zodat de side-effects (netwerk-IO naar webhooks/PSP) de HTTP-response
 * niet ophouden. Eventuele fouten worden hier gelogd, nooit gegooid.
 *
 * BELANGRIJK: deze functies doen hun EIGEN IO (DB-reads + netwerk). Ze worden
 * daarom altijd ná de DB-transactie aangeroepen, NOOIT erbinnen.
 */
import { logger } from '../../lib/logger.js';
import { sendNotification } from '../notifications/send.js';
import { dispatchWebhookEvent } from '../webhooks/dispatch.js';
import { requestReviewInvitation } from '../reviews/invite.js';
import type { Order } from '../../db/schema/orders.js';

/**
 * Laatste vangnet rond een al-never-throw service. Logt + slikt elke fout zodat
 * een `void fire*()` nooit een unhandled rejection oplevert.
 */
async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.warn({ err, hook: label }, `order-event side-effect failed (swallowed): ${label}`);
  }
}

/** Mens-leesbare klantnaam uit losse velden, met fallback. */
function customerName(
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string | null,
): string {
  const full = [firstName ?? '', lastName ?? ''].join(' ').trim();
  if (full) return full;
  return (fallback ?? '').trim();
}

/** Compacte order-samenvatting voor webhook-payloads (geen PII-overkill). */
function orderSummary(order: Order): Record<string, unknown> {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    shopId: order.shopId,
    channel: order.channel,
    status: order.status,
    financialStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    currency: order.currency,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingTotal: order.shippingTotal,
    taxTotal: order.taxTotal,
    grandTotal: order.grandTotal,
    email: order.email,
    customerId: order.customerId,
    placedAt: order.placedAt ? order.placedAt.toISOString() : null,
  };
}

export interface CustomerNameParts {
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * Order is financieel 'paid' geworden (admin-payment of mock-checkout).
 * Vuurt: webhook `order.paid` + (optioneel) bevestigingsmail.
 *
 * @param sendConfirmation default true — zet op false als de mail elders al is
 *   verstuurd (voorkomt dubbel mailen).
 */
export async function fireOrderPaid(
  order: Order,
  opts: { name?: CustomerNameParts; sendConfirmation?: boolean } = {},
): Promise<void> {
  await safe('order.paid:webhook', () =>
    dispatchWebhookEvent('order.paid', orderSummary(order), { shopId: order.shopId }),
  );

  const sendConfirmation = opts.sendConfirmation !== false;
  if (sendConfirmation && order.email) {
    await safe('order.paid:email', () =>
      sendNotification({
        templateKey: 'order_confirmation',
        to: order.email as string,
        data: {
          customerName: customerName(opts.name?.firstName, opts.name?.lastName, order.email),
          orderNumber: order.orderNumber,
          total: order.grandTotal ?? '',
          currency: order.currency,
        },
        orderId: order.id,
      }),
    );
  }
}

/**
 * Order is aangemaakt via de storefront-checkout. Vuurt webhook `order.created`.
 * (De bevestigingsmail loopt via {@link fireOrderPaid} zodra de order 'paid' is —
 * de mock-checkout is direct paid, dus de caller roept beide aan.)
 */
export async function fireOrderCreated(order: Order): Promise<void> {
  await safe('order.created:webhook', () =>
    dispatchWebhookEvent('order.created', orderSummary(order), { shopId: order.shopId }),
  );
}

/**
 * Een fulfillment/shipment is aangemaakt. Vuurt: verzendmail + webhook
 * `order.fulfilled` + review-uitnodiging (fulfillment is een goede proxy voor
 * "vraag om een review").
 */
export async function fireOrderFulfilled(
  order: Order,
  fulfillment: { trackingUrl?: string | null; trackingCode?: string | null; carrier?: string | null },
  opts: { name?: CustomerNameParts } = {},
): Promise<void> {
  const name = customerName(opts.name?.firstName, opts.name?.lastName, order.email);

  await safe('order.fulfilled:webhook', () =>
    dispatchWebhookEvent(
      'order.fulfilled',
      {
        ...orderSummary(order),
        carrier: fulfillment.carrier ?? null,
        trackingCode: fulfillment.trackingCode ?? null,
        trackingUrl: fulfillment.trackingUrl ?? null,
      },
      { shopId: order.shopId },
    ),
  );

  if (order.email) {
    await safe('order.fulfilled:email', () =>
      sendNotification({
        templateKey: 'order_shipped',
        to: order.email as string,
        data: {
          customerName: name,
          orderNumber: order.orderNumber,
          trackingUrl: fulfillment.trackingUrl ?? '',
          trackingCode: fulfillment.trackingCode ?? '',
          carrier: fulfillment.carrier ?? '',
        },
        orderId: order.id,
      }),
    );

    await safe('order.fulfilled:review', () =>
      requestReviewInvitation({
        email: order.email as string,
        orderId: order.id,
        name: name || undefined,
      }),
    );
  }
}

/** Order is geannuleerd. Vuurt webhook `order.cancelled`. */
export async function fireOrderCancelled(order: Order): Promise<void> {
  await safe('order.cancelled:webhook', () =>
    dispatchWebhookEvent('order.cancelled', orderSummary(order), { shopId: order.shopId }),
  );
}

/**
 * Een return is aangemaakt of verwerkt. Vuurt webhook `return.received` +
 * (afhankelijk van status) een 'order_refunded'- of 'return_received'-mail.
 *
 * @param refunded true als de return-status 'refunded' is (→ order_refunded-mail).
 */
export async function fireReturnEvent(
  ret: { id: string; orderId: string | null; shopId: string; status: string; refundAmount: string },
  order: { email?: string | null; orderNumber?: string | null; currency?: string | null } | null,
  opts: { refunded: boolean },
): Promise<void> {
  await safe('return.received:webhook', () =>
    dispatchWebhookEvent(
      'return.received',
      {
        id: ret.id,
        orderId: ret.orderId,
        shopId: ret.shopId,
        status: ret.status,
        refundAmount: ret.refundAmount,
      },
      { shopId: ret.shopId },
    ),
  );

  const email = order?.email ?? null;
  if (email) {
    const templateKey = opts.refunded ? 'order_refunded' : 'return_received';
    await safe(`${templateKey}:email`, () =>
      sendNotification({
        templateKey,
        to: email,
        data: {
          orderNumber: order?.orderNumber ?? '',
          refundAmount: ret.refundAmount,
          currency: order?.currency ?? '',
        },
        orderId: ret.orderId ?? undefined,
      }),
    );
  }
}
