/**
 * BolAdapter — turnkey, CONNECT-READY adapter for the bol.com Retailer API v10.
 *
 * This adapter implements the OFFICIAL bol contract exactly (OAuth2
 * client-credentials, v10 media-type, demo/production base URL, async
 * ProcessStatus polling, 429 backoff) but is READY UP TO THE KEY-ENTRY POINT:
 * nothing live ever fires without credentials. Every network-touching method
 * first calls the private `requireCreds()` guard, which throws a typed
 * {@link ChannelNotConnectedError} ('Bol credentials required') when the channel
 * is not `status='connected'` or the clientId/clientSecret are empty. Once the
 * operator wires real credentials and flips the channel to connected, these
 * methods call the real endpoints through the low-level {@link BolClient}.
 *
 * Credentials shape (stored encrypted, decrypted in-memory by the route):
 *   { clientId: string, clientSecret: string }
 * Config (plain jsonb on the channel):
 *   { environment?: 'demo' | 'production' }   // defaults to 'demo'
 *
 * Auth: OAuth2 client-credentials against https://login.bol.com/token, then a
 * cached Bearer JWT against https://api.bol.com/retailer(-demo) with the
 * application/vnd.retailer.v10+json media type. The JWT is cached in-memory per
 * channel by {@link BolClient}, so we do NOT fetch a token per request.
 *
 * Endpoints used:
 *   - GET  /orders?status=OPEN&fulfilment-method=FBR (+ page pagination)
 *   - GET  /orders/{order-id}                         (per-order line detail)
 *   - POST /shipments                                 (async → ProcessStatus)
 *   - PUT  /orders/cancellation                       (async → ProcessStatus)
 *   - PUT  /offers/{offerId}/stock                    (async → ProcessStatus)
 *   - PUT  /offers/{offerId}/price                    (async → ProcessStatus)
 */
import type { Channel } from '../../../db/schema/channels.js';
import { decryptCredentials } from '../../../lib/channel-crypto.js';
import {
  BolClient,
  bolApiBaseUrl,
  type BolEnvironment,
} from './_bol-client.js';
import {
  ChannelNotConnectedError,
  type ChannelAdapter,
  type NormalizedOrder,
  type NormalizedOrderItem,
  type PublishableVariant,
  type PushListingResult,
  type ShipmentInput,
  type VerifyResult,
} from './types.js';

interface BolCredentials {
  clientId: string;
  clientSecret: string;
}

/** Resolved per-channel runtime context (creds + chosen environment + id). */
interface BolContext {
  creds: BolCredentials;
  environment: BolEnvironment;
  channelId: string;
}

/** Default carrier transporter-code when a shipment omits one (bol enum). */
const DEFAULT_TRANSPORTER_CODE = 'TNT';

export class BolAdapter implements ChannelAdapter {
  readonly type = 'bol';

  // ─── Credential + environment resolution ──────────────────

  /**
   * Guard: returns the decrypted credentials + resolved environment only when
   * the channel is connected and has both clientId + clientSecret. Otherwise
   * throws the typed not-connected error so NO live request can fire.
   */
  private requireCreds(channel: Channel): BolContext {
    if (channel.status !== 'connected') {
      throw new ChannelNotConnectedError('Bol credentials required');
    }
    const creds = decryptCredentials(
      (channel.credentials ?? null) as { enc: string } | null,
    );
    const clientId = creds && typeof creds.clientId === 'string' ? creds.clientId : '';
    const clientSecret =
      creds && typeof creds.clientSecret === 'string' ? creds.clientSecret : '';
    if (!clientId || !clientSecret) {
      throw new ChannelNotConnectedError('Bol credentials required');
    }
    return {
      creds: { clientId, clientSecret },
      environment: this.resolveEnvironment(channel),
      channelId: channel.id,
    };
  }

  /** Read config.environment, defaulting to 'demo' until the operator flips it. */
  private resolveEnvironment(channel: Channel): BolEnvironment {
    const cfg = (channel.config ?? {}) as { environment?: unknown };
    return cfg.environment === 'production' ? 'production' : 'demo';
  }

  /** Construct a low-level client bound to this channel's creds/environment. */
  private client(ctx: BolContext): BolClient {
    return new BolClient({
      clientId: ctx.creds.clientId,
      clientSecret: ctx.creds.clientSecret,
      environment: ctx.environment,
      cacheKey: ctx.channelId,
    });
  }

  // ─── Connection check ──────────────────────────────────────

  /**
   * verifyConnection never throws — it converts the not-connected guard into a
   * clean {ok:false} so the UI can show a friendly message. When connected it
   * performs the real OAuth handshake (proving clientId/secret are valid).
   */
  async verifyConnection(channel: Channel): Promise<VerifyResult> {
    let ctx: BolContext;
    try {
      ctx = this.requireCreds(channel);
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Bol credentials required',
      };
    }
    try {
      await this.client(ctx).getToken();
      return {
        ok: true,
        detail: `Bol Retailer API v10 (${ctx.environment}) verbonden`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'bol connection failed',
      };
    }
  }

  // ─── Orders ────────────────────────────────────────────────

  /**
   * Pull all OPEN, FBR orders. Bol returns a thin order list; for each order we
   * GET /orders/{id} to fetch the full orderItems before normalizing. Paginates
   * `page=1..N` until the page comes back empty.
   */
  async fetchOrders(channel: Channel): Promise<NormalizedOrder[]> {
    const ctx = this.requireCreds(channel);
    const client = this.client(ctx);

    const summaries: Array<Record<string, unknown>> = [];
    for (let page = 1; ; page += 1) {
      const body = await client.request<{ orders?: Record<string, unknown>[] }>(
        '/orders',
        { query: { status: 'OPEN', 'fulfilment-method': 'FBR', page } },
      );
      const pageOrders = Array.isArray(body?.orders) ? body!.orders! : [];
      if (pageOrders.length === 0) break;
      summaries.push(...pageOrders);
      // Defensive: bol caps the list page size; if a partial page comes back we
      // still loop once more and stop on the empty page.
    }

    const out: NormalizedOrder[] = [];
    for (const summary of summaries) {
      const orderId = pickOrderId(summary);
      if (!orderId) continue;
      const full = await client.request<Record<string, unknown>>(
        `/orders/${encodeURIComponent(orderId)}`,
      );
      out.push(this.normalizeOrder(full ?? summary));
    }
    return out;
  }

  /**
   * Bol has no explicit "acknowledge order" call (an order is acknowledged by
   * shipping it). We re-fetch the order so the guard still runs and the call is
   * a valid no-op confirmation that the order exists.
   */
  async acknowledgeOrder(channel: Channel, externalId: string): Promise<void> {
    const ctx = this.requireCreds(channel);
    await this.client(ctx).request(`/orders/${encodeURIComponent(externalId)}`);
  }

  /**
   * Confirm a shipment for an order. Bol ships at the order-ITEM level, so we
   * resolve the order's items and ship them all with the given transport. The
   * POST returns a ProcessStatus which we poll to completion.
   */
  async submitShipment(
    channel: Channel,
    externalId: string,
    shipment: ShipmentInput,
  ): Promise<void> {
    const ctx = this.requireCreds(channel);
    const client = this.client(ctx);

    const order = await client.request<Record<string, unknown>>(
      `/orders/${encodeURIComponent(externalId)}`,
    );
    const orderItems = collectShipmentItems(order ?? {});

    const status = await client.request<Record<string, unknown>>('/shipments', {
      method: 'POST',
      body: {
        orderItems,
        transport: {
          transporterCode: shipment.carrier ?? DEFAULT_TRANSPORTER_CODE,
          trackAndTrace: shipment.trackingCode ?? undefined,
        },
      },
    });
    await this.awaitProcess(client, status, 'submitShipment');
  }

  /**
   * Cancel an order's items. Bol exposes a bulk cancellation endpoint:
   * PUT /orders/cancellation with the order items + a reason code.
   */
  async cancelOrder(
    channel: Channel,
    externalId: string,
    reasonCode = 'OUT_OF_STOCK',
  ): Promise<void> {
    const ctx = this.requireCreds(channel);
    const client = this.client(ctx);

    const order = await client.request<Record<string, unknown>>(
      `/orders/${encodeURIComponent(externalId)}`,
    );
    const ids = collectOrderItemIds(order ?? {});
    const status = await client.request<Record<string, unknown>>(
      '/orders/cancellation',
      {
        method: 'PUT',
        body: {
          orderItems: ids.map((orderItemId) => ({ orderItemId, reasonCode })),
        },
      },
    );
    await this.awaitProcess(client, status, 'cancelOrder');
  }

  // ─── Offers (listings / price / stock) ─────────────────────

  /**
   * Update the price of an existing offer. `variant.externalId`-bearing rows map
   * to an offerId; the route resolves that from `channel_products.externalId`
   * and passes it as the variant's SKU/id. Returns the offerId as externalId.
   */
  async pushListing(
    channel: Channel,
    variant: PublishableVariant,
  ): Promise<PushListingResult> {
    const ctx = this.requireCreds(channel);
    const client = this.client(ctx);
    const offerId = resolveOfferId(variant);

    const status = await client.request<Record<string, unknown>>(
      `/offers/${encodeURIComponent(offerId)}/price`,
      {
        method: 'PUT',
        body: {
          pricing: {
            bundlePrices: [{ quantity: 1, unitPrice: toNumber(variant.price) }],
          },
        },
      },
    );
    await this.awaitProcess(client, status, 'pushListing');
    return { externalId: offerId };
  }

  /**
   * Reflect available stock for an offer. `variantId` carries the offerId
   * resolved by the route from `channel_products.externalId`.
   */
  async updateInventory(
    channel: Channel,
    variantId: string,
    available: number,
  ): Promise<void> {
    const ctx = this.requireCreds(channel);
    const client = this.client(ctx);
    const status = await client.request<Record<string, unknown>>(
      `/offers/${encodeURIComponent(variantId)}/stock`,
      {
        method: 'PUT',
        body: { amount: Math.max(0, Math.trunc(available)), managedByRetailer: true },
      },
    );
    await this.awaitProcess(client, status, 'updateInventory');
  }

  // ─── Async ProcessStatus helper ───────────────────────────

  /**
   * Poll the ProcessStatus returned by a write call and throw on FAILURE so the
   * route surfaces a real error instead of a silent partial success.
   */
  private async awaitProcess(
    client: BolClient,
    statusBody: Record<string, unknown> | undefined,
    op: string,
  ): Promise<void> {
    if (!statusBody) return;
    const initial = BolClient.parseProcessStatus(statusBody);
    if (!initial.processStatusId) return;
    const final =
      initial.status === 'PENDING'
        ? await client.pollProcessStatus(initial.processStatusId)
        : initial;
    if (final.status === 'FAILURE' || final.status === 'TIMEOUT') {
      throw new Error(
        `bol ${op} ${final.status.toLowerCase()}: ${final.errorMessage ?? 'no detail'}`,
      );
    }
  }

  // ─── Normalization ─────────────────────────────────────────

  /** Map a raw bol order (v10) to the channel-agnostic NormalizedOrder. */
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    const externalId = pickOrderId(raw) ?? '';
    const rawItems = Array.isArray(raw.orderItems)
      ? (raw.orderItems as Record<string, unknown>[])
      : [];
    const items: NormalizedOrderItem[] = rawItems.map((li) => {
      const product = (li.product ?? {}) as Record<string, unknown>;
      return {
        sku:
          typeof product.ean === 'string'
            ? product.ean
            : typeof li.ean === 'string'
              ? li.ean
              : null,
        title: typeof product.title === 'string' ? product.title : null,
        quantity:
          typeof li.quantity === 'number'
            ? li.quantity
            : Number(li.quantity ?? 1) || 1,
        unitPrice:
          li.unitPrice != null
            ? String(li.unitPrice)
            : li.commission != null
              ? String(li.commission)
              : '0',
        taxRate: null,
        costPrice: null,
      };
    });
    return {
      externalId,
      channelType: this.type,
      email: null, // bol anonymizes buyer e-mail
      currency: 'EUR',
      placedAt:
        typeof raw.orderPlacedDateTime === 'string' ? raw.orderPlacedDateTime : null,
      items,
      raw,
    };
  }

  /** Exposed for diagnostics/tests: resolved base URL for a channel. */
  baseUrlFor(channel: Channel): string {
    return bolApiBaseUrl(this.resolveEnvironment(channel));
  }
}

// ─── Pure helpers (unit-tested in isolation) ─────────────────

/** Extract the bol order id from either the list-summary or detail shape. */
function pickOrderId(raw: Record<string, unknown>): string | null {
  if (typeof raw.orderId === 'string' && raw.orderId) return raw.orderId;
  if (raw.orderId != null) return String(raw.orderId);
  if (typeof raw.id === 'string' && raw.id) return raw.id;
  return null;
}

/** Resolve an offerId from a publishable variant (externalId preferred). */
function resolveOfferId(variant: PublishableVariant): string {
  const ext = (variant as { externalId?: unknown }).externalId;
  if (typeof ext === 'string' && ext) return ext;
  return variant.sku ?? variant.variantId;
}

/** Build the `{orderItemId, quantity}` array a /shipments POST needs. */
function collectShipmentItems(
  order: Record<string, unknown>,
): Array<{ orderItemId: string; quantity: number }> {
  const items = Array.isArray(order.orderItems)
    ? (order.orderItems as Record<string, unknown>[])
    : [];
  return items
    .map((li) => {
      const orderItemId =
        typeof li.orderItemId === 'string' ? li.orderItemId : String(li.orderItemId ?? '');
      const quantity =
        typeof li.quantity === 'number' ? li.quantity : Number(li.quantity ?? 1) || 1;
      return { orderItemId, quantity };
    })
    .filter((x) => x.orderItemId.length > 0);
}

/** Collect just the order-item ids (for cancellation). */
function collectOrderItemIds(order: Record<string, unknown>): string[] {
  const items = Array.isArray(order.orderItems)
    ? (order.orderItems as Record<string, unknown>[])
    : [];
  return items
    .map((li) =>
      typeof li.orderItemId === 'string' ? li.orderItemId : String(li.orderItemId ?? ''),
    )
    .filter((id) => id.length > 0);
}

/** Coerce a money STRING to the number bol's JSON price fields expect. */
function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export const bolAdapter = new BolAdapter();
