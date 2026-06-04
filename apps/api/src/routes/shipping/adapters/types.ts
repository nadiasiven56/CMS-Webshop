/**
 * ShipmentAdapter — uniform contract for every shipping-carrier integration.
 *
 * The route-layer never talks to a carrier SDK directly; it talks to a
 * `ShipmentAdapter`. Each concrete adapter (sendcloud / myparcel / postnl) maps
 * the carrier's quirks to the CRM's normalized shapes below.
 *
 * Conventions:
 *   - Money stays a decimal STRING (priceString) — never a float.
 *   - `verifyConnection` is the only method cheap + side-effect free enough to
 *     call on demand from the UI ("test connection"). It NEVER throws.
 *   - Carrier adapters are CONNECT-READY (koppel-klaar): every network-touching
 *     method first calls a private `requireCreds()` guard which throws a typed
 *     {@link CarrierNotConnectedError} instead of firing a live request, until
 *     the operator wires real credentials and flips the carrier to 'connected'.
 */
import type { ShippingCarrier } from '../../../db/schema/shipping.js';

/** A postal address used as ship-to on a label. */
export interface ShipmentAddress {
  /** Recipient name. */
  name: string;
  /** Company, optional. */
  company?: string | null;
  /** Street + house number (line 1). */
  street: string;
  /** Apartment / addition (line 2). */
  street2?: string | null;
  postalCode: string;
  city: string;
  /** State / province, optional. */
  province?: string | null;
  /** ISO-3166-1 alpha-2 country code (e.g. 'NL'). */
  country: string;
  email?: string | null;
  phone?: string | null;
}

/**
 * Normalized input handed to `createLabel`. Channel-agnostic; the adapter maps
 * it to the carrier-specific request body.
 */
export interface ShipmentLabelInput {
  /** CRM order id this shipment belongs to. */
  orderId: string;
  /** Human order reference / number snapshot (printed on the label). */
  orderReference: string;
  /** Ship-to address. */
  toAddress: ShipmentAddress;
  /** Parcel weight in grams. */
  weightGrams: number;
  /** Carrier service / method code, optional (adapter picks a default). */
  service?: string | null;
}

/** Result of `createLabel` — a freshly created label + tracking. */
export interface CreateLabelResult {
  trackingCode: string;
  trackingUrl: string;
  labelUrl: string;
  /** Original raw payload — stored verbatim in shipments.raw for audit. */
  raw: Record<string, unknown>;
}

/** A single tracking event in chronological order. */
export interface TrackingEvent {
  /** ISO-8601 timestamp of the event. */
  at: string;
  /** Normalized carrier status string. */
  status: string;
  /** Human description of the event. */
  description: string;
}

/** Result of `getTracking`. */
export interface TrackingResult {
  /** Latest normalized status (pending | in_transit | delivered | error | ...). */
  status: string;
  events: TrackingEvent[];
  /** Original raw payload. */
  raw: Record<string, unknown>;
}

/** Input for an optional `getRates` quote. */
export interface RateInput {
  toAddress: ShipmentAddress;
  weightGrams: number;
}

/** A single quoted shipping rate. */
export interface ShipmentRate {
  /** Service / method name (e.g. 'PostNL Standard'). */
  service: string;
  /** Price as a decimal STRING (Money, never a float). */
  priceString: string;
  /** ISO-4217 currency (e.g. 'EUR'). */
  currency: string;
}

/** Result of `verifyConnection`. */
export interface VerifyResult {
  ok: boolean;
  detail: string;
}

/**
 * Typed "not connected" signal. Adapters throw this from their `requireCreds()`
 * guard so the route-layer can translate it to a clean 409 without leaking which
 * network call would have fired. Mirrors ChannelNotConnectedError.
 */
export class CarrierNotConnectedError extends Error {
  readonly error = 'carrier_not_connected' as const;
  constructor(message: string) {
    super(message);
    this.name = 'CarrierNotConnectedError';
  }
}

/** Type-guard for {@link CarrierNotConnectedError} (works across realms). */
export function isCarrierNotConnectedError(
  e: unknown,
): e is CarrierNotConnectedError {
  return (
    e instanceof CarrierNotConnectedError ||
    (typeof e === 'object' &&
      e !== null &&
      (e as { error?: unknown }).error === 'carrier_not_connected')
  );
}

/**
 * Shared adapter contract. Every concrete carrier adapter implements this. The
 * route-layer resolves the adapter via the registry and never hard-codes a
 * carrier SDK.
 */
export interface ShipmentAdapter {
  /** Carrier code this adapter handles: 'sendcloud' | 'myparcel' | 'postnl'. */
  readonly code: string;

  /** Cheap reachability/credentials check. NEVER throws — returns ok:false. */
  verifyConnection(carrier: ShippingCarrier): Promise<VerifyResult>;

  /** Create a shipping label. Guarded — throws CarrierNotConnectedError until connected. */
  createLabel(
    carrier: ShippingCarrier,
    input: ShipmentLabelInput,
  ): Promise<CreateLabelResult>;

  /** Fetch tracking for a shipment. Guarded — throws until connected. */
  getTracking(
    carrier: ShippingCarrier,
    trackingCode: string,
  ): Promise<TrackingResult>;

  /** Optional rate quote. Guarded — throws until connected. */
  getRates?(
    carrier: ShippingCarrier,
    input: RateInput,
  ): Promise<ShipmentRate[]>;
}
