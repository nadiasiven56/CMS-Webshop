/**
 * Shipping-router — `/api/shipping/*`.
 *
 * Carrier-beheer (sendcloud/myparcel/postnl/dhl) + label-generatie + tracking,
 * gebouwd "koppel-klaar" zoals de Bol/Amazon channel-adapters: volledige
 * scaffolding, maar elke netwerk-call zit achter een `requireCreds()`-guard die
 * een typed {@link CarrierNotConnectedError} ('carrier_not_connected') gooit tot
 * echte credentials zijn ingevoerd. De route-laag praat NOOIT direct met een
 * carrier-SDK — altijd via een {@link ShipmentAdapter} uit de adapter-registry.
 *
 * Endpoints (alle achter `requireAuth`):
 *   GET    /api/shipping/carriers                       — list (masked creds + counts)
 *   POST   /api/shipping/carriers                       — create {code,name,config}
 *   GET    /api/shipping/carriers/:id                   — detail (masked + counts)
 *   PATCH  /api/shipping/carriers/:id                   — partial update (name/config/status)
 *   DELETE /api/shipping/carriers/:id                   — delete (shipments → carrier set null)
 *   PUT    /api/shipping/carriers/:id/credentials       — encrypt → store + verify → status
 *   POST   /api/shipping/carriers/:id/test-connection   — verify → update status + lastTestAt
 *   POST   /api/shipping/shipments                      — create label for an order (guarded → 409)
 *   GET    /api/shipping/shipments?order_id=&limit=&offset=  — list
 *   GET    /api/shipping/shipments/:id                  — detail
 *   GET    /api/shipping/shipments/:id/tracking         — adapter.getTracking (guarded → 409)
 *
 * KRITISCH: credentials worden encrypted opgeslagen (channel-crypto) en NOOIT
 * raw teruggegeven (alleen masked presence-map via _serialize).
 *
 * Wired in routes/index.ts door de orchestrator — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { encryptCredentials } from '../../lib/channel-crypto.js';
import {
  shippingCarriers,
  shipments,
  type ShippingCarrier,
} from '../../db/schema/shipping.js';
import { orders } from '../../db/schema/orders.js';
import { getShipmentAdapter } from './adapters/index.js';
import { isCarrierNotConnectedError, type ShipmentLabelInput } from './adapters/types.js';
import {
  CarrierCreateSchema,
  CarrierListQuerySchema,
  CarrierPatchSchema,
  CREDENTIALS_SCHEMA_BY_CODE,
  ShipmentCreateSchema,
  ShipmentListQuerySchema,
} from './_schemas.js';
import {
  toCarrierDto,
  toCarrierDetailDto,
  toShipmentDto,
} from './_serialize.js';

export const shippingRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles — admin-module.
shippingRoutes.use('*', requireAuth);

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

/** Count shipments per carrier — volgt het channels-count-patroon. */
async function countCarrierShipments(carrierId: string): Promise<{ shipments: number }> {
  const ids = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(eq(shipments.carrierId, carrierId));
  return { shipments: ids.length };
}

/** Map an adapter tracking status onto a shipments.status value. */
function trackingStatusToShipmentStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('deliver')) return 'delivered';
  if (s.includes('transit') || s.includes('en_route') || s.includes('sorting')) {
    return 'in_transit';
  }
  if (s.includes('error') || s.includes('fail') || s.includes('exception')) return 'error';
  return 'in_transit';
}

// ─── GET /carriers — list ────────────────────────────────────

shippingRoutes.get('/carriers', async (c) => {
  const parsed = CarrierListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { status, code, limit, offset } = parsed.data;

  const conditions = [];
  if (status) conditions.push(eq(shippingCarriers.status, status));
  if (code) conditions.push(eq(shippingCarriers.code, code));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(shippingCarriers)
    .orderBy(asc(shippingCarriers.name))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: shippingCarriers.id }).from(shippingCarriers).where(whereExpr)
    : db.select({ id: shippingCarriers.id }).from(shippingCarriers));

  const items = await Promise.all(
    rows.map(async (carrier) => {
      const counts = await countCarrierShipments(carrier.id);
      return toCarrierDetailDto(carrier, counts);
    }),
  );

  return c.json({ items, total: allIds.length, limit, offset });
});

// ─── POST /carriers — create ─────────────────────────────────

shippingRoutes.post('/carriers', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = CarrierCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  // code is UNIQUE — voorkom een dubbele carrier voor dezelfde provider.
  const [dup] = await db
    .select({ id: shippingCarriers.id })
    .from(shippingCarriers)
    .where(eq(shippingCarriers.code, input.code))
    .limit(1);
  if (dup) return c.json({ error: 'carrier_code_exists', code: input.code }, 409);

  const carrier = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .insert(shippingCarriers)
      .values({
        code: input.code,
        name: input.name,
        status: 'disconnected',
        config: input.config ?? {},
      })
      .returning();
    if (!row) throw new Error('shipping_carrier insert returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'shipping_carrier',
      entityId: row.id,
      before: null,
      after: { id: row.id, code: row.code, name: row.name, status: row.status },
      ip: ip(c),
    });
    return row;
  });

  logger.info({ carrierId: carrier.id, code: carrier.code, actor: user.id }, 'carrier created');
  return c.json({ carrier: toCarrierDetailDto(carrier, { shipments: 0 }) }, 201);
});

// ─── GET /carriers/:id — detail ──────────────────────────────

shippingRoutes.get('/carriers/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [carrier] = await db
    .select()
    .from(shippingCarriers)
    .where(eq(shippingCarriers.id, id))
    .limit(1);
  if (!carrier) return c.json({ error: 'not_found' }, 404);

  const counts = await countCarrierShipments(id);
  return c.json({ carrier: toCarrierDetailDto(carrier, counts) });
});

// ─── PATCH /carriers/:id — update ────────────────────────────

shippingRoutes.patch('/carriers/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = CarrierPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;

  const [existing] = await db
    .select()
    .from(shippingCarriers)
    .where(eq(shippingCarriers.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) setValues.name = patch.name;
  if (patch.config !== undefined) setValues.config = patch.config;
  if (patch.status !== undefined) setValues.status = patch.status;

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(shippingCarriers)
      .set(setValues)
      .where(eq(shippingCarriers.id, id))
      .returning();
    if (!row) throw new Error('shipping_carrier update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'shipping_carrier',
      entityId: row.id,
      before: { name: existing.name, status: existing.status, config: existing.config },
      after: { name: row.name, status: row.status, config: row.config },
      ip: ip(c),
    });
    return row;
  });

  const counts = await countCarrierShipments(id);
  logger.info({ carrierId: id, actor: user.id }, 'carrier updated');
  return c.json({ carrier: toCarrierDetailDto(updated, counts) });
});

// ─── DELETE /carriers/:id ────────────────────────────────────

shippingRoutes.delete('/carriers/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [existing] = await db
    .select()
    .from(shippingCarriers)
    .where(eq(shippingCarriers.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  await runInTransactionWithAudit(async (tx, audit) => {
    // shipments.carrier_id wordt via FK onDelete:'set null' losgekoppeld; de
    // shipment-historie + carrier_code-snapshot blijven bestaan.
    await tx.delete(shippingCarriers).where(eq(shippingCarriers.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'shipping_carrier',
      entityId: id,
      before: { id: existing.id, code: existing.code, name: existing.name },
      after: null,
      ip: ip(c),
    });
  });

  logger.info({ carrierId: id, actor: user.id }, 'carrier deleted');
  return c.json({ ok: true, id });
});

// ─── PUT /carriers/:id/credentials — encrypt + store + verify ─

shippingRoutes.put('/carriers/:id/credentials', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [existing] = await db
    .select()
    .from(shippingCarriers)
    .where(eq(shippingCarriers.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const schema =
    CREDENTIALS_SCHEMA_BY_CODE[existing.code as keyof typeof CREDENTIALS_SCHEMA_BY_CODE];
  if (schema === undefined) {
    return c.json({ error: 'unsupported_carrier_code', code: existing.code }, 422);
  }
  if (schema === null) {
    // bv. dhl — nog geen adapter/credential-shape.
    return c.json(
      { error: 'no_credentials_schema', message: `${existing.code} has no credential schema yet` },
      422,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }

  const encrypted = encryptCredentials(parsed.data as Record<string, unknown>);

  // Stage 1: store encrypted creds. We zetten status NOG NIET op connected — dat
  // doen we pas na een geslaagde verify (anders zou requireCreds doorlaten op een
  // niet-geverifieerde sleutel).
  const stored = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(shippingCarriers)
      .set({ credentials: encrypted, updatedAt: new Date() })
      .where(eq(shippingCarriers.id, id))
      .returning();
    if (!row) throw new Error('shipping_carrier credentials update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'shipping_carrier',
      entityId: row.id,
      // NOOIT de raw creds in audit — alleen dat ze gezet zijn.
      before: { hadCredentials: existing.credentials != null },
      after: { hasCredentials: true, fields: Object.keys(parsed.data as object) },
      ip: ip(c),
    });
    return row;
  });

  // Stage 2: verify met de zojuist opgeslagen creds. We forceren status tijdelijk
  // op 'connected' in-memory zodat de adapter-guard de creds accepteert en een
  // echte verify kan doen; het persisteren van de status hangt af van het
  // resultaat.
  const adapter = getShipmentAdapter(stored.code);
  let nextStatus: ShippingCarrier['status'] = stored.status;
  let verifyDetail = 'no adapter for this carrier code';
  if (adapter) {
    const probe: ShippingCarrier = { ...stored, status: 'connected' };
    const verify = await adapter.verifyConnection(probe);
    verifyDetail = verify.detail;
    nextStatus = verify.ok ? 'connected' : 'error';
  }

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(shippingCarriers)
      .set({ status: nextStatus, lastTestAt: new Date(), updatedAt: new Date() })
      .where(eq(shippingCarriers.id, id))
      .returning();
    if (!row) throw new Error('shipping_carrier status update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'shipping_carrier',
      entityId: row.id,
      before: { status: stored.status },
      after: { status: row.status, verifyDetail },
      ip: ip(c),
    });
    return row;
  });

  const counts = await countCarrierShipments(id);
  logger.info({ carrierId: id, status: updated.status, actor: user.id }, 'carrier credentials stored');
  return c.json({
    carrier: toCarrierDetailDto(updated, counts),
    verify: { ok: updated.status === 'connected', detail: verifyDetail },
  });
});

// ─── POST /carriers/:id/test-connection ──────────────────────

shippingRoutes.post('/carriers/:id/test-connection', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [carrier] = await db
    .select()
    .from(shippingCarriers)
    .where(eq(shippingCarriers.id, id))
    .limit(1);
  if (!carrier) return c.json({ error: 'not_found' }, 404);

  const adapter = getShipmentAdapter(carrier);
  if (!adapter) {
    return c.json({ error: 'unsupported_carrier_code', code: carrier.code }, 422);
  }

  // verifyConnection decrypteert in-memory (binnen de adapter) en throwt NOOIT.
  const verify = await adapter.verifyConnection(carrier);
  const nextStatus = verify.ok ? 'connected' : 'error';

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(shippingCarriers)
      .set({ status: nextStatus, lastTestAt: new Date(), updatedAt: new Date() })
      .where(eq(shippingCarriers.id, id))
      .returning();
    if (!row) throw new Error('shipping_carrier status update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'shipping_carrier',
      entityId: row.id,
      before: { status: carrier.status },
      after: { status: row.status, verifyDetail: verify.detail },
      ip: ip(c),
    });
    return row;
  });

  const counts = await countCarrierShipments(id);
  return c.json({
    ok: verify.ok,
    detail: verify.detail,
    carrier: toCarrierDetailDto(updated, counts),
  });
});

// ─── POST /shipments — create label for an order (guarded) ───

shippingRoutes.post('/shipments', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ShipmentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  // Order moet bestaan (FK is cascade — we willen een nette 404 i.p.v. DB-error).
  const [order] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (!order) return c.json({ error: 'order_not_found' }, 404);

  const [carrier] = await db
    .select()
    .from(shippingCarriers)
    .where(eq(shippingCarriers.id, input.carrierId))
    .limit(1);
  if (!carrier) return c.json({ error: 'carrier_not_found' }, 404);

  const adapter = getShipmentAdapter(carrier);
  if (!adapter) {
    return c.json({ error: 'unsupported_carrier_code', code: carrier.code }, 422);
  }

  const labelInput: ShipmentLabelInput = {
    orderId: order.id,
    orderReference: order.orderNumber,
    toAddress: {
      name: input.toAddress.name,
      company: input.toAddress.company ?? null,
      street: input.toAddress.street,
      street2: input.toAddress.street2 ?? null,
      postalCode: input.toAddress.postalCode,
      city: input.toAddress.city,
      province: input.toAddress.province ?? null,
      country: input.toAddress.country,
      email: input.toAddress.email ?? null,
      phone: input.toAddress.phone ?? null,
    },
    weightGrams: input.weightGrams ?? 1000,
    service: input.service ?? null,
  };

  // createLabel is guarded: gooit CarrierNotConnectedError tot de carrier
  // connected is. Dan persisteren we GEEN shipment en geven 409.
  let label;
  try {
    label = await adapter.createLabel(carrier, labelInput);
  } catch (err) {
    if (isCarrierNotConnectedError(err)) {
      return c.json(
        { error: 'carrier_not_connected', message: err instanceof Error ? err.message : 'not connected' },
        409,
      );
    }
    return c.json(
      { error: 'create_label_failed', message: err instanceof Error ? err.message : 'failed' },
      502,
    );
  }

  const shipment = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .insert(shipments)
      .values({
        orderId: order.id,
        carrierId: carrier.id,
        carrierCode: carrier.code,
        trackingCode: label.trackingCode || null,
        trackingUrl: label.trackingUrl || null,
        labelUrl: label.labelUrl || null,
        status: 'label_created',
        weightGrams: input.weightGrams ?? null,
        raw: label.raw,
      })
      .returning();
    if (!row) throw new Error('shipment insert returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'shipment',
      entityId: row.id,
      before: null,
      after: {
        id: row.id,
        orderId: row.orderId,
        carrierCode: row.carrierCode,
        trackingCode: row.trackingCode,
        status: row.status,
      },
      ip: ip(c),
    });
    return row;
  });

  logger.info(
    { shipmentId: shipment.id, orderId: order.id, carrier: carrier.code, actor: user.id },
    'shipment label created',
  );
  return c.json({ shipment: toShipmentDto(shipment) }, 201);
});

// ─── GET /shipments — list ───────────────────────────────────

shippingRoutes.get('/shipments', async (c) => {
  const parsed = ShipmentListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { order_id, status, limit, offset } = parsed.data;

  const conditions = [];
  if (order_id) conditions.push(eq(shipments.orderId, order_id));
  if (status) conditions.push(eq(shipments.status, status));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(shipments)
    .orderBy(desc(shipments.createdAt))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: shipments.id }).from(shipments).where(whereExpr)
    : db.select({ id: shipments.id }).from(shipments));

  return c.json({
    items: rows.map(toShipmentDto),
    total: allIds.length,
    limit,
    offset,
  });
});

// ─── GET /shipments/:id — detail ─────────────────────────────

shippingRoutes.get('/shipments/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [shipment] = await db
    .select()
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);
  if (!shipment) return c.json({ error: 'not_found' }, 404);

  return c.json({ shipment: toShipmentDto(shipment) });
});

// ─── GET /shipments/:id/tracking — guarded ───────────────────

shippingRoutes.get('/shipments/:id/tracking', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [shipment] = await db
    .select()
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);
  if (!shipment) return c.json({ error: 'not_found' }, 404);
  if (!shipment.trackingCode) {
    return c.json({ error: 'no_tracking_code', message: 'shipment has no tracking code yet' }, 409);
  }
  if (!shipment.carrierId) {
    return c.json({ error: 'carrier_unlinked', message: 'shipment carrier was removed' }, 409);
  }

  const [carrier] = await db
    .select()
    .from(shippingCarriers)
    .where(eq(shippingCarriers.id, shipment.carrierId))
    .limit(1);
  if (!carrier) return c.json({ error: 'carrier_not_found' }, 404);

  const adapter = getShipmentAdapter(carrier);
  if (!adapter) {
    return c.json({ error: 'unsupported_carrier_code', code: carrier.code }, 422);
  }

  let tracking;
  try {
    tracking = await adapter.getTracking(carrier, shipment.trackingCode);
  } catch (err) {
    if (isCarrierNotConnectedError(err)) {
      return c.json(
        { error: 'carrier_not_connected', message: err instanceof Error ? err.message : 'not connected' },
        409,
      );
    }
    return c.json(
      { error: 'tracking_failed', message: err instanceof Error ? err.message : 'failed' },
      502,
    );
  }

  // Reflecteer de afgeleide status terug op de shipment-row (+ audit).
  const nextStatus = trackingStatusToShipmentStatus(tracking.status);
  if (nextStatus !== shipment.status) {
    await runInTransactionWithAudit(async (tx, audit) => {
      const [row] = await tx
        .update(shipments)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(shipments.id, id))
        .returning();
      audit.set({
        actor: { type: 'user', id: user.id },
        action: 'update',
        entityType: 'shipment',
        entityId: id,
        before: { status: shipment.status },
        after: { status: row?.status ?? nextStatus, trackingStatus: tracking.status },
        ip: ip(c),
      });
    });
  }

  return c.json({
    shipmentId: id,
    status: nextStatus,
    carrierStatus: tracking.status,
    events: tracking.events,
  });
});
