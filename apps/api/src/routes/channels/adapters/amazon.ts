/**
 * AmazonAdapter — CONNECT-READY, OFFICIAL-contract adapter for the Amazon
 * Selling Partner API (SP-API).
 *
 * Auth model: **LWA-only** (NO AWS SigV4). The Login-with-Amazon refresh-token
 * grant yields an access-token that is sent as the `x-amz-access-token` header
 * (NEVER `Authorization: Bearer`). The regional host (eu/na/fe) + a
 * sandbox/production toggle pick the base URL; the API version lives in the
 * URL PATH. Buyer PII (addresses/names) requires a Restricted Data Token (RDT),
 * which the underlying {@link SpApiClient} mints on demand.
 *
 * Guard contract (mirrors {@link ./bol.ts BolAdapter}): nothing live ever fires
 * without credentials. Every network-touching method calls `requireCreds()`
 * first, which throws a typed {@link ChannelNotConnectedError} when the channel
 * is not `status='connected'` or the LWA credentials are empty. The route-layer
 * translates that into a clean `{ error:'channel_not_connected' }`.
 *
 * Credential fields (validated by the route's zod schema, stored encrypted):
 *   - lwaClientId      (alias: clientId)        — LWA app client id        [required]
 *   - lwaClientSecret  (alias: clientSecret)    — LWA app client secret    [required]
 *   - refreshToken     — LWA refresh token                                 [required]
 *   - sellerId         — merchant/seller id (for the listings path)        [optional]
 *   - marketplaceIds   (alias: marketplaceId)   — e.g. A1805IZSGTT6HS (NL)  [optional]
 *   - region           — 'eu' | 'na' | 'fe' (default 'eu')                 [optional]
 *   - environment      — 'sandbox' | 'production' (default 'production')   [optional]
 *
 * `region`/`environment`/`marketplaceIds` may also be supplied via
 * `channel.config` (config takes precedence over a credential default, since
 * the operator toggles sandbox from the channel config UI).
 */
import type { Channel } from '../../../db/schema/channels.js';
import { decryptCredentials } from '../../../lib/channel-crypto.js';
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
import {
  DEFAULT_MARKETPLACE_ID,
  DEFAULT_REGION,
  MARKETPLACES,
  SP_API_HOSTS,
  SpApiClient,
  SpApiError,
  type SpApiClientDeps,
  type SpApiCredentials,
} from './_spapi-client.js';

/** Re-export the marketplaces map for callers/UI dropdowns. */
export { MARKETPLACES } from './_spapi-client.js';

/** The exact credential field names the operator enters for this channel. */
export const AMAZON_CREDENTIAL_FIELDS = [
  'lwaClientId',
  'lwaClientSecret',
  'refreshToken',
  'sellerId',
  'marketplaceIds',
  'region',
  'environment',
] as const;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Pick the first non-empty string among the given keys of an object. */
function pick(obj: Record<string, unknown> | null, ...keys: string[]): string {
  if (!obj) return '';
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

export class AmazonAdapter implements ChannelAdapter {
  readonly type = 'amazon';

  /** Optional dep-injection for tests (fake fetch/clock/sleep). */
  constructor(private readonly clientDeps: SpApiClientDeps = {}) {}

  /**
   * Guard: returns the decrypted, normalized credentials only when the channel
   * is connected and has the 3 required LWA fields. Otherwise throws the typed
   * not-connected error so NO live request can fire.
   *
   * Accepts both the official field names (lwaClientId/lwaClientSecret/
   * marketplaceIds) and the legacy aliases (clientId/clientSecret/marketplaceId)
   * for backward compatibility with already-stored credentials.
   */
  private requireCreds(channel: Channel): SpApiCredentials {
    if (channel.status !== 'connected') {
      throw new ChannelNotConnectedError('Amazon credentials required');
    }
    const creds = decryptCredentials(
      (channel.credentials ?? null) as { enc: string } | null,
    );
    const config = (channel.config ?? null) as Record<string, unknown> | null;

    const lwaClientId = pick(creds, 'lwaClientId', 'clientId');
    const lwaClientSecret = pick(creds, 'lwaClientSecret', 'clientSecret');
    const refreshToken = pick(creds, 'refreshToken');
    if (!lwaClientId || !lwaClientSecret || !refreshToken) {
      throw new ChannelNotConnectedError('Amazon credentials required');
    }

    // marketplaceIds: config wins, then credentials, then NL default.
    const marketplaceId =
      pick(config, 'marketplaceIds', 'marketplaceId') ||
      pick(creds, 'marketplaceIds', 'marketplaceId') ||
      DEFAULT_MARKETPLACE_ID;

    // region: config wins, then credentials, then (derive from marketplace), else eu.
    const regionRaw =
      pick(config, 'region') || pick(creds, 'region') || this.regionForMarketplace(marketplaceId);
    const region = SP_API_HOSTS[regionRaw] ? regionRaw : DEFAULT_REGION;

    // environment: config wins, then credentials, else production.
    const envRaw = pick(config, 'environment') || pick(creds, 'environment');
    const environment: 'sandbox' | 'production' =
      envRaw === 'sandbox' ? 'sandbox' : 'production';

    const sellerId = pick(creds, 'sellerId') || undefined;

    return {
      lwaClientId,
      lwaClientSecret,
      refreshToken,
      sellerId,
      marketplaceId,
      region,
      environment,
    };
  }

  /** Map a marketplace id back to its region (eu/na/fe); defaults to eu. */
  private regionForMarketplace(marketplaceId: string): string {
    for (const m of Object.values(MARKETPLACES)) {
      if (m.id === marketplaceId) return m.region;
    }
    return DEFAULT_REGION;
  }

  /** Build a per-call SP-API client bound to this channel's credentials. */
  private client(creds: SpApiCredentials): SpApiClient {
    return new SpApiClient(creds, this.clientDeps);
  }

  /** Human label for verify/detail strings. */
  private label(creds: SpApiCredentials): string {
    return `${creds.region}/${creds.environment}`;
  }

  /**
   * verifyConnection never throws — it converts the not-connected guard into a
   * clean {ok:false} so the UI can show a friendly message. When connected it
   * performs the real LWA handshake (proving clientId/secret/refreshToken).
   */
  async verifyConnection(channel: Channel): Promise<VerifyResult> {
    let creds: SpApiCredentials;
    try {
      creds = this.requireCreds(channel);
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Amazon credentials required',
      };
    }
    try {
      await this.client(creds).getAccessToken();
      return {
        ok: true,
        detail: `Amazon SP-API (${this.label(creds)}) verbonden`,
      };
    } catch (err) {
      return {
        ok: false,
        detail:
          err instanceof SpApiError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'amazon connection failed',
      };
    }
  }

  /**
   * Pull recent orders. SP-API requires `CreatedAfter`; we page through
   * `NextToken` and, for each order, fetch its order-items. Buyer-address
   * access is PII-restricted, so the order list is fetched with an RDT.
   */
  async fetchOrders(channel: Channel): Promise<NormalizedOrder[]> {
    const creds = this.requireCreds(channel);
    const client = this.client(creds);

    // Mint an RDT for the restricted getOrders resource (buyer PII).
    const rdt = await client.getRdt([
      {
        method: 'GET',
        path: '/orders/v0/orders',
        dataElements: ['buyerInfo', 'shippingAddress'],
      },
    ]);

    const createdAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const orders: Record<string, unknown>[] = [];
    let nextToken: string | undefined;

    do {
      const query: Record<string, string | undefined> = nextToken
        ? { MarketplaceIds: creds.marketplaceId, NextToken: nextToken }
        : { MarketplaceIds: creds.marketplaceId, CreatedAfter: createdAfter };

      const page = await client.request<{
        payload?: { Orders?: Record<string, unknown>[]; NextToken?: string };
      }>('getOrders', {
        method: 'GET',
        path: '/orders/v0/orders',
        query,
        accessToken: rdt, // restricted: buyer PII
      });
      const payload = page.payload ?? {};
      for (const o of payload.Orders ?? []) orders.push(o);
      nextToken = typeof payload.NextToken === 'string' ? payload.NextToken : undefined;
    } while (nextToken);

    // Enrich each order with its line-items (separate, version-pathed endpoint).
    const out: NormalizedOrder[] = [];
    for (const o of orders) {
      const amazonOrderId = str(o.AmazonOrderId);
      let items: Record<string, unknown>[] = [];
      if (amazonOrderId) {
        try {
          const itemsRes = await client.request<{
            payload?: { OrderItems?: Record<string, unknown>[] };
          }>('getOrderItems', {
            method: 'GET',
            path: `/orders/v0/orders/${encodeURIComponent(amazonOrderId)}/orderItems`,
            query: { MarketplaceIds: creds.marketplaceId },
          });
          items = itemsRes.payload?.OrderItems ?? [];
        } catch {
          // An items-fetch failure should not drop the whole order; keep header.
          items = [];
        }
      }
      out.push(this.normalizeOrder({ ...o, OrderItems: items }));
    }
    return out;
  }

  async acknowledgeOrder(channel: Channel, externalId: string): Promise<void> {
    const creds = this.requireCreds(channel);
    const client = this.client(creds);
    // SP-API has no generic "acknowledge"; reading the order back confirms it
    // exists/accessible. (FBM acknowledgement is via feeds; out of scope here.)
    await client.request('getOrders', {
      method: 'GET',
      path: `/orders/v0/orders/${encodeURIComponent(externalId)}`,
    });
  }

  async submitShipment(
    channel: Channel,
    externalId: string,
    shipment: ShipmentInput,
  ): Promise<void> {
    const creds = this.requireCreds(channel);
    const client = this.client(creds);
    // Merchant-fulfilled shipment confirmation (Orders API v0).
    await client.request('confirmShipment', {
      method: 'POST',
      path: `/orders/v0/orders/${encodeURIComponent(externalId)}/shipmentConfirmation`,
      body: {
        marketplaceId: creds.marketplaceId,
        packageDetail: {
          carrierCode: shipment.carrier ?? undefined,
          trackingNumber: shipment.trackingCode ?? undefined,
        },
      },
    });
  }

  /**
   * Publish/update a listing via the Listings Items API (PATCH on the
   * version-pathed listings resource). Pushes the price + offer availability.
   */
  async pushListing(
    channel: Channel,
    variant: PublishableVariant,
  ): Promise<PushListingResult> {
    const creds = this.requireCreds(channel);
    const client = this.client(creds);
    const sku = variant.sku ?? variant.variantId;
    await client.request('patchListingsItem', {
      method: 'PATCH',
      path: `/listings/2021-08-01/items/${encodeURIComponent(client.sellerId)}/${encodeURIComponent(sku)}`,
      query: { marketplaceIds: creds.marketplaceId },
      body: {
        productType: 'PRODUCT',
        patches: [
          {
            op: 'replace',
            path: '/attributes/purchasable_offer',
            value: [
              {
                marketplace_id: creds.marketplaceId,
                currency: this.currencyForMarketplace(creds.marketplaceId),
                our_price: [
                  { schedule: [{ value_with_tax: Number(variant.price) }] },
                ],
              },
            ],
          },
          {
            // A disabled listing is taken offline by removing offer availability;
            // an enabled listing is created with 0 stock — updateInventory then
            // sets the real quantity (price and stock are separate operations).
            op: variant.enabled ? 'replace' : 'delete',
            path: '/attributes/fulfillment_availability',
            value: variant.enabled
              ? [{ fulfillment_channel_code: 'DEFAULT', quantity: 0 }]
              : undefined,
          },
        ],
      },
    });
    return { externalId: sku };
  }

  /**
   * Reflect available stock to the channel via a JSON patch on
   * fulfillment_availability/quantity (Listings Items API, version-pathed).
   */
  async updateInventory(
    channel: Channel,
    variantId: string,
    available: number,
  ): Promise<void> {
    const creds = this.requireCreds(channel);
    const client = this.client(creds);
    await client.request('patchListingsItem', {
      method: 'PATCH',
      path: `/listings/2021-08-01/items/${encodeURIComponent(client.sellerId)}/${encodeURIComponent(variantId)}`,
      query: { marketplaceIds: creds.marketplaceId },
      body: {
        productType: 'PRODUCT',
        patches: [
          {
            op: 'replace',
            path: '/attributes/fulfillment_availability',
            value: [
              { fulfillment_channel_code: 'DEFAULT', quantity: available },
            ],
          },
        ],
      },
    });
  }

  private currencyForMarketplace(marketplaceId: string): string {
    for (const m of Object.values(MARKETPLACES)) {
      if (m.id === marketplaceId) return m.currency;
    }
    return 'EUR';
  }

  /** Map a raw SP-API order payload to the normalized order shape. */
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    const externalId = str(raw.AmazonOrderId) || String(raw.AmazonOrderId ?? raw.orderId ?? raw.id ?? '');

    const rawItems = Array.isArray(raw.OrderItems)
      ? (raw.OrderItems as Record<string, unknown>[])
      : [];
    const items: NormalizedOrderItem[] = rawItems.map((li) => {
      const itemPrice = (li.ItemPrice ?? {}) as Record<string, unknown>;
      const itemTax = (li.ItemTax ?? {}) as Record<string, unknown>;
      const qty =
        typeof li.QuantityOrdered === 'number'
          ? li.QuantityOrdered
          : Number(li.QuantityOrdered ?? 1) || 1;
      // SP-API ItemPrice is an order-line TOTAL; derive per-unit for the CRM.
      const lineTotal = itemPrice.Amount != null ? Number(itemPrice.Amount) : 0;
      const unitPrice = qty > 0 ? (lineTotal / qty).toFixed(4) : lineTotal.toFixed(4);
      return {
        sku: str(li.SellerSKU) || null,
        title: str(li.Title) || null,
        quantity: qty,
        unitPrice,
        taxRate: null,
        costPrice: itemTax.Amount != null ? String(itemTax.Amount) : null,
      };
    });

    const buyerInfo = (raw.BuyerInfo ?? {}) as Record<string, unknown>;
    const orderTotal = (raw.OrderTotal ?? {}) as Record<string, unknown>;
    return {
      externalId,
      channelType: this.type,
      email: str(buyerInfo.BuyerEmail) || null,
      currency: str(orderTotal.CurrencyCode) || 'EUR',
      placedAt: str(raw.PurchaseDate) || null,
      items,
      raw,
    };
  }
}

export const amazonAdapter = new AmazonAdapter();
