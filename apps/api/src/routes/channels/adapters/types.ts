/**
 * ChannelAdapter — uniform contract for every sales-channel integration.
 *
 * The route-layer never talks to a marketplace SDK directly; it talks to a
 * `ChannelAdapter`. Each concrete adapter (own_webshop / bol / amazon) maps the
 * marketplace's quirks to the CRM's normalized shapes below.
 *
 * Conventions:
 *   - Money stays a decimal STRING (numeric(12,4) — never a float).
 *   - `verifyConnection` is the only method that should be cheap + side-effect
 *     free enough to call on demand from the UI ("test connection").
 *   - Marketplace adapters that are CONNECT-READY (bol/amazon) must guard every
 *     network-touching method behind a credentials check and surface a typed
 *     {@link ChannelNotConnectedError} instead of firing a live request.
 */
import type { Channel } from '../../../db/schema/channels.js';

/** A single normalized order-line as seen across channels. */
export interface NormalizedOrderItem {
  /** Marketplace SKU / our SKU if resolvable. */
  sku: string | null;
  /** Human title snapshot. */
  title: string | null;
  /** Whole units ordered. */
  quantity: number;
  /** Per-unit price, ex/incl per the channel — money STRING. */
  unitPrice: string;
  /** VAT rate as money/percent STRING (e.g. '21'); adapter best-effort. */
  taxRate: string | null;
  /** Cost price if the channel exposes it — money STRING or null. */
  costPrice: string | null;
}

/** Channel-agnostic order shape produced by `normalizeOrder` / `fetchOrders`. */
export interface NormalizedOrder {
  /** Stable id at the source (orderNumber for own_webshop, order-id at bol/amazon). */
  externalId: string;
  /** Source channel type the order came from. */
  channelType: string;
  /** Buyer e-mail if exposed by the channel. */
  email: string | null;
  /** ISO-3 / ISO-4217 currency. */
  currency: string;
  /** When the order was placed at the source, ISO-8601, or null. */
  placedAt: string | null;
  /** Order lines. */
  items: NormalizedOrderItem[];
  /** Original raw payload — stored verbatim in channel_orders.raw for audit. */
  raw: Record<string, unknown>;
  /**
   * If this order already exists as a CRM order (own_webshop case), the CRM
   * order id so the sync can just link instead of re-creating it.
   */
  crmOrderId?: string | null;
}

/** A normalized listing (product/variant published to a channel). */
export interface NormalizedListing {
  /** CRM variant id. */
  variantId: string;
  /** CRM product id. */
  productId: string;
  /** SKU snapshot. */
  sku: string | null;
  /** Marketplace-side id once pushed (own_webshop reuses the variant id). */
  externalId: string | null;
  /** Effective price pushed to the channel — money STRING. */
  price: string;
  /** Whether the listing should be live on the channel. */
  enabled: boolean;
}

/** Shipment payload handed to `submitShipment`. */
export interface ShipmentInput {
  carrier?: string | null;
  trackingCode?: string | null;
  trackingUrl?: string | null;
}

/** Minimal published-variant shape `pushListing` consumes. */
export interface PublishableVariant {
  variantId: string;
  productId: string;
  sku: string | null;
  /** Effective price (override or variant price) — money STRING. */
  price: string;
  enabled: boolean;
}

/**
 * Typed "not connected" signal. Adapters for bol/amazon throw this from their
 * `requireCreds()` guard so the route-layer can translate it to a clean 409
 * without leaking which network call would have fired.
 */
export class ChannelNotConnectedError extends Error {
  readonly error = 'channel_not_connected' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ChannelNotConnectedError';
  }
}

/** Type-guard for {@link ChannelNotConnectedError} (works across realms). */
export function isChannelNotConnectedError(
  e: unknown,
): e is ChannelNotConnectedError {
  return (
    e instanceof ChannelNotConnectedError ||
    (typeof e === 'object' &&
      e !== null &&
      (e as { error?: unknown }).error === 'channel_not_connected')
  );
}

/** Result of `verifyConnection`. */
export interface VerifyResult {
  ok: boolean;
  detail: string;
}

/** Result of `pushListing`. */
export interface PushListingResult {
  externalId: string;
}

/**
 * Shared adapter contract. `tx` is optional on the write-flavoured methods so an
 * adapter can participate in an outer transaction (own_webshop sync) or run
 * stand-alone. We keep it untyped-generic (`DbOrTx`) via the route-layer; the
 * interface itself only declares the channel-facing surface.
 */
export interface ChannelAdapter {
  /** Channel type this adapter handles: 'own_webshop' | 'bol' | 'amazon'. */
  readonly type: string;

  /** Cheap reachability/credentials check. Never throws — returns ok:false. */
  verifyConnection(channel: Channel): Promise<VerifyResult>;

  /** Pull orders from the channel into normalized shape. */
  fetchOrders(channel: Channel): Promise<NormalizedOrder[]>;

  /** Acknowledge receipt of an order at the source (marketplace requirement). */
  acknowledgeOrder(channel: Channel, externalId: string): Promise<void>;

  /** Push a shipment/tracking back to the channel. */
  submitShipment(
    channel: Channel,
    externalId: string,
    shipment: ShipmentInput,
  ): Promise<void>;

  /** Publish/update a single variant listing. Returns the external id. */
  pushListing(
    channel: Channel,
    variant: PublishableVariant,
  ): Promise<PushListingResult>;

  /** Reflect available stock for a variant to the channel. */
  updateInventory(
    channel: Channel,
    variantId: string,
    available: number,
  ): Promise<void>;

  /** Map a raw channel payload to the normalized order shape. */
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder;
}
