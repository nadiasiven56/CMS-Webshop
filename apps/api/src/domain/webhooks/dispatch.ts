/**
 * Outbound-webhook dispatcher.
 *
 * Vuurt domein-events af naar geabonneerde endpoints met HMAC-signed payloads en
 * schrijft per poging een `webhook_deliveries`-log-rij. De publieke
 * {@link dispatchWebhookEvent} is het integratie-contract dat de orchestrator
 * vanuit order-/return-/product-/stock-flows aanroept.
 *
 * GARANTIE: gooit NOOIT naar de caller. Elke individuele aflevering is in een
 * try/catch gewikkeld; een falende endpoint (timeout, 5xx, DNS-fout) breekt het
 * order-proces dus nooit. Fouten worden gelogd én als delivery-rij vastgelegd.
 *
 * Dependency-free: global `fetch` + `AbortController` (Node 18+) + `node:crypto`
 * via {@link signPayload}.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { webhooks, type Webhook } from '../../db/schema/webhooks.js';
import { webhookDeliveries } from '../../db/schema/webhook-deliveries.js';
import {
  eventCategory,
  type WebhookEvent,
  type WebhookEventPayload,
} from './events.js';
import {
  signPayload,
  SIGNATURE_HEADER,
  EVENT_HEADER,
} from './sign.js';

/** Timeout per aflevering. Een trage endpoint mag de flow niet ophouden. */
const DELIVERY_TIMEOUT_MS = 8000;

/** Response-body's groter dan dit worden getrunceerd voordat ze in de log gaan. */
const MAX_RESPONSE_BODY = 8000;

/** Het minimale target-shape dat een aflevering nodig heeft. */
export interface DeliveryTarget {
  /** webhooks.id, of null voor een ad-hoc test-fire zonder webhook-row. */
  webhookId: string | null;
  url: string;
  secret: string | null;
}

export interface DeliveryResult {
  webhookId: string | null;
  url: string;
  success: boolean;
  responseStatus: number | null;
  durationMs: number;
  errorMessage: string | null;
  /** id van de geschreven webhook_deliveries-rij (null als de log-insert faalde). */
  deliveryId: string | null;
}

/**
 * Bouw de envelope en serialiseer stabiel (top-level keys gesorteerd) zodat de
 * signature deterministisch is voor een gegeven event+data+tijd.
 */
function buildBody(event: WebhookEvent, data: Record<string, unknown>, occurredAt: string): string {
  const payload: WebhookEventPayload = { event, occurredAt, data };
  // Stabiele top-level volgorde: event, occurredAt, data.
  return JSON.stringify({
    event: payload.event,
    occurredAt: payload.occurredAt,
    data: payload.data,
  });
}

/**
 * Match-semantiek t.o.v. de BESTAANDE webhooks-tabel (event + scope):
 *
 *  - `event` matcht als het exact gelijk is aan het afgevuurde event, OF een
 *    wildcard is: `*` (alles) of `<category>.*` (hele categorie, bv `order.*`).
 *  - `scope` (grove enum `order` | `channel` | `all`, vrij text in DB) matcht als
 *    het `all`/`*` is OF gelijk is aan de categorie van het event (`order.created`
 *    → categorie `order`). Onbekende/lege scope wordt soepel toegelaten zodat
 *    handmatig aangemaakte rows niet stil falen.
 *
 * Beide moeten kloppen (AND). Zo honoreren we zowel het fijnmazige `event`-veld
 * als de grove `scope`-categorie die de admin-CRUD hanteert.
 */
export function webhookMatchesEvent(wh: Pick<Webhook, 'event' | 'scope'>, event: string): boolean {
  const category = eventCategory(event);

  // event-veld
  const we = wh.event.trim();
  const eventOk =
    we === event ||
    we === '*' ||
    (we.endsWith('.*') && we.slice(0, -2) === category);
  if (!eventOk) return false;

  // scope-veld (grove categorie)
  const scope = (wh.scope ?? '').trim().toLowerCase();
  const scopeOk =
    scope === '' || scope === 'all' || scope === '*' || scope === category;
  return scopeOk;
}

/** Truncate + null-safe maak van een response-body voor de log. */
function truncate(text: string | null): string | null {
  if (text == null) return null;
  return text.length > MAX_RESPONSE_BODY ? `${text.slice(0, MAX_RESPONSE_BODY)}…[truncated]` : text;
}

/**
 * Lever één event af aan één target: signeer, POST met timeout, en schrijf een
 * delivery-log-rij. Gooit NOOIT — fouten worden als `success:false`-rij gelogd.
 */
async function deliverOne(
  target: DeliveryTarget,
  event: WebhookEvent,
  body: string,
  attempt = 1,
): Promise<DeliveryResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [EVENT_HEADER]: event,
  };
  if (target.secret) {
    headers[SIGNATURE_HEADER] = signPayload(target.secret, body);
  }

  const started = Date.now();
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let success = false;
  let errorMessage: string | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    responseStatus = res.status;
    success = res.ok; // 2xx
    responseBody = truncate(await res.text().catch(() => null));
    if (!success) {
      errorMessage = `endpoint responded ${res.status}`;
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      errorMessage = `timeout after ${DELIVERY_TIMEOUT_MS}ms`;
    } else {
      errorMessage = err instanceof Error ? err.message : 'fetch failed';
    }
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - started;

  // Headers die we loggen — NOOIT de secret zelf, alleen dát er gesigneerd is.
  const loggedHeaders: Record<string, string> = {
    'Content-Type': headers['Content-Type'] as string,
    [EVENT_HEADER]: event,
    ...(target.secret ? { [SIGNATURE_HEADER]: 'sha256=<redacted>' } : {}),
  };

  // payload weer parsen naar object voor jsonb-kolom (body is altijd valide JSON).
  let payloadObj: Record<string, unknown> | null = null;
  try {
    payloadObj = JSON.parse(body) as Record<string, unknown>;
  } catch {
    payloadObj = null;
  }

  let deliveryId: string | null = null;
  try {
    const [row] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: target.webhookId,
        event,
        url: target.url,
        payload: payloadObj ?? undefined,
        requestHeaders: loggedHeaders,
        responseStatus,
        responseBody,
        success,
        attempt,
        errorMessage,
        durationMs,
      })
      .returning({ id: webhookDeliveries.id });
    deliveryId = row?.id ?? null;
  } catch (err) {
    // Log-insert mag de flow óók niet breken.
    logger.error(
      { err, webhookId: target.webhookId, url: target.url, event },
      'webhook delivery-log insert failed',
    );
  }

  if (success) {
    logger.info(
      { webhookId: target.webhookId, url: target.url, event, responseStatus, durationMs },
      'webhook delivered',
    );
  } else {
    logger.warn(
      { webhookId: target.webhookId, url: target.url, event, responseStatus, durationMs, errorMessage },
      'webhook delivery failed',
    );
  }

  return {
    webhookId: target.webhookId,
    url: target.url,
    success,
    responseStatus,
    durationMs,
    errorMessage,
    deliveryId,
  };
}

/**
 * Lever één target af + bump `webhooks.lastFiredAt` als het een echte webhook-row
 * is. Best-effort; gooit nooit.
 */
async function deliverAndStamp(
  target: DeliveryTarget,
  event: WebhookEvent,
  body: string,
): Promise<DeliveryResult> {
  const result = await deliverOne(target, event, body);
  if (target.webhookId) {
    try {
      await db
        .update(webhooks)
        .set({ lastFiredAt: new Date() })
        .where(eq(webhooks.id, target.webhookId));
    } catch (err) {
      logger.error({ err, webhookId: target.webhookId }, 'webhook lastFiredAt update failed');
    }
  }
  return result;
}

/**
 * Publiek integratie-contract. Vuurt `event` af naar alle actieve, matchende
 * webhooks (rekening houdend met `opts.shopId`: een webhook met `shop_id=null`
 * is globaal en vuurt altijd; een webhook met een `shop_id` vuurt alleen als die
 * gelijk is aan `opts.shopId`).
 *
 * @returns `{ matched, delivered }` — hoeveel webhooks matchten en hoeveel een
 *   2xx teruggaven. Gooit NOOIT naar de caller.
 */
export async function dispatchWebhookEvent(
  event: WebhookEvent,
  data: Record<string, unknown>,
  opts?: { shopId?: string | null },
): Promise<{ delivered: number; matched: number }> {
  const shopId = opts?.shopId ?? null;
  const occurredAt = new Date().toISOString();

  try {
    // shop-filter in SQL: globale webhooks (shop_id null) OF die van deze shop.
    const shopCondition = shopId
      ? or(isNull(webhooks.shopId), eq(webhooks.shopId, shopId))
      : isNull(webhooks.shopId);

    const candidates = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.active, true), shopCondition));

    // event/scope-match in applicatie-laag (ondersteunt wildcards).
    const targets = candidates.filter((wh) => webhookMatchesEvent(wh, event));

    if (targets.length === 0) {
      return { matched: 0, delivered: 0 };
    }

    const body = buildBody(event, data, occurredAt);

    const results = await Promise.all(
      targets.map((wh) =>
        deliverAndStamp(
          { webhookId: wh.id, url: wh.url, secret: wh.secret },
          event,
          body,
        ),
      ),
    );

    const delivered = results.filter((r) => r.success).length;
    return { matched: targets.length, delivered };
  } catch (err) {
    // Catch-all: zelfs een DB-fout bij het laden mag de caller niet breken.
    logger.error({ err, event, shopId }, 'dispatchWebhookEvent failed');
    return { matched: 0, delivered: 0 };
  }
}

/**
 * Single-target aflevering voor de test-fire-route. Hergebruikt exact het
 * delivery-pad (signeer + POST + log + lastFiredAt-bump). Gooit nooit.
 */
export async function dispatchToTarget(
  target: DeliveryTarget,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<DeliveryResult> {
  const body = buildBody(event, data, new Date().toISOString());
  return deliverAndStamp(target, event, body);
}
