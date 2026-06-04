/**
 * Webhooks-router — `/api/webhooks/*`.
 *
 * Dit is de DELIVERY-/dispatch-laag bovenop de bestaande webhook-CRUD (die
 * blijft in `/api/admin/webhooks`). Hier:
 *   - inzage in de append-only delivery-log (`webhook_deliveries`);
 *   - een handmatige test-fire om een endpoint te verifieren;
 *   - de event-catalogus voor de admin-UI-dropdown.
 *
 * Het feitelijke afvuren op domein-events gebeurt via
 * `domain/webhooks/dispatch.ts::dispatchWebhookEvent(...)`, die de orchestrator
 * vanuit order-/return-flows aanroept (zie REGISTER.md).
 *
 * Endpoints (alle achter `requireAuth`):
 *   GET  /api/webhooks/events            — de WEBHOOK_EVENTS-catalogus
 *   GET  /api/webhooks/deliveries        — delivery-log (filter webhook_id/event/success, paginate)
 *   GET  /api/webhooks/deliveries/:id    — één delivery (volle payload/response)
 *   POST /api/webhooks/test-fire         — vuur een sample-payload naar 1 webhook of ad-hoc url
 *
 * Wired in routes/index.ts door de orchestrator — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import { webhooks } from '../../db/schema/webhooks.js';
import { webhookDeliveries } from '../../db/schema/webhook-deliveries.js';
import { WEBHOOK_EVENTS, type WebhookEvent } from '../../domain/webhooks/events.js';
import { dispatchToTarget } from '../../domain/webhooks/dispatch.js';
import { DeliveryListQuerySchema, TestFireSchema } from './_schemas.js';
import { toDeliveryListDto, toDeliveryDetailDto } from './_serialize.js';

export const webhookRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles — admin-module.
webhookRoutes.use('*', requireAuth);

/** Sample-data voor een test-fire van een gegeven event (klein, herkenbaar). */
function sampleDataFor(event: WebhookEvent): Record<string, unknown> {
  const now = new Date().toISOString();
  switch (event) {
    case 'order.created':
    case 'order.paid':
    case 'order.fulfilled':
    case 'order.cancelled':
      return { orderId: '00000000-0000-0000-0000-000000000000', orderNumber: 'TEST-1001', total: '49.95', currency: 'EUR', at: now };
    case 'return.created':
    case 'return.received':
      return { returnId: '00000000-0000-0000-0000-000000000000', orderNumber: 'TEST-1001', at: now };
    case 'product.created':
    case 'product.updated':
      return { productId: '00000000-0000-0000-0000-000000000000', title: 'Test product', at: now };
    case 'stock.low':
      return { variantId: '00000000-0000-0000-0000-000000000000', sku: 'TEST-SKU', available: 2, threshold: 5, at: now };
    default:
      return { test: true, at: now };
  }
}

// ─── GET /api/webhooks/events — catalogus ────────────────────
// Statisch pad — definieer vóór de generieke routes.

webhookRoutes.get('/events', (c) => {
  return c.json({ events: WEBHOOK_EVENTS });
});

// ─── POST /api/webhooks/test-fire — handmatige test ──────────

webhookRoutes.post('/test-fire', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = TestFireSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  let target: { webhookId: string | null; url: string; secret: string | null };
  let event: WebhookEvent;

  if (input.webhookId) {
    const [wh] = await db.select().from(webhooks).where(eq(webhooks.id, input.webhookId)).limit(1);
    if (!wh) return c.json({ error: 'not_found' }, 404);
    target = { webhookId: wh.id, url: input.url ?? wh.url, secret: input.secret ?? wh.secret };
    // event-keuze: expliciet > webhook.event (als bekend) > order.created.
    event =
      input.event ??
      ((WEBHOOK_EVENTS as readonly string[]).includes(wh.event)
        ? (wh.event as WebhookEvent)
        : 'order.created');
  } else {
    // Ad-hoc url-target — schema garandeert dat url + event gezet zijn.
    target = { webhookId: null, url: input.url as string, secret: input.secret ?? null };
    event = input.event as WebhookEvent;
  }

  const data = input.data ?? sampleDataFor(event);

  // dispatchToTarget throwt nooit; schrijft zelf de delivery-log-rij + bump.
  const result = await dispatchToTarget(target, event, data);

  logger.info(
    { webhookId: target.webhookId, url: target.url, event, success: result.success, actor: user.id },
    'webhook test-fire',
  );

  return c.json({
    ok: result.success,
    event,
    delivery: {
      id: result.deliveryId,
      webhookId: result.webhookId,
      url: result.url,
      success: result.success,
      responseStatus: result.responseStatus,
      durationMs: result.durationMs,
      errorMessage: result.errorMessage,
    },
  });
});

// ─── GET /api/webhooks/deliveries — log (newest first) ───────

webhookRoutes.get('/deliveries', async (c) => {
  const parsed = DeliveryListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { webhook_id, event, success, limit, offset } = parsed.data;

  const conditions = [];
  if (webhook_id) conditions.push(eq(webhookDeliveries.webhookId, webhook_id));
  if (event) conditions.push(eq(webhookDeliveries.event, event));
  if (success !== undefined) conditions.push(eq(webhookDeliveries.success, success));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(webhookDeliveries)
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: webhookDeliveries.id }).from(webhookDeliveries).where(whereExpr)
    : db.select({ id: webhookDeliveries.id }).from(webhookDeliveries));

  return c.json({
    items: rows.map(toDeliveryListDto),
    total: allIds.length,
    limit,
    offset,
  });
});

// ─── GET /api/webhooks/deliveries/:id — detail ───────────────

webhookRoutes.get('/deliveries/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [delivery] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, id))
    .limit(1);
  if (!delivery) return c.json({ error: 'not_found' }, 404);

  return c.json({ delivery: toDeliveryDetailDto(delivery) });
});
