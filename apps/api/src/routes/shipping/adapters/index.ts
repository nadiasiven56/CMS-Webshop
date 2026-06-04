/**
 * Adapter registry — resolves a carrier (or a bare code string) to its concrete
 * {@link ShipmentAdapter}.
 *
 * Supported codes (with a registered adapter):
 *   - sendcloud → CONNECT-READY Sendcloud API v2 adapter.
 *   - myparcel  → CONNECT-READY MyParcel API adapter.
 *   - postnl    → CONNECT-READY PostNL API adapter.
 *
 * `dhl` is a seeded carrier code WITHOUT an adapter yet — `getShipmentAdapter`
 * returns `null` for it so the route can answer a clean 422 instead of throwing.
 *
 * The route-layer always goes through `getShipmentAdapter()` so it never
 * hard-codes a specific carrier SDK.
 */
import type { ShippingCarrier } from '../../../db/schema/shipping.js';
import { sendcloudAdapter } from './sendcloud.js';
import { myparcelAdapter } from './myparcel.js';
import { postnlAdapter } from './postnl.js';
import type { ShipmentAdapter } from './types.js';

const REGISTRY: Record<string, ShipmentAdapter> = {
  sendcloud: sendcloudAdapter,
  myparcel: myparcelAdapter,
  postnl: postnlAdapter,
};

/** All carrier codes that have a registered adapter. */
export const SUPPORTED_CARRIER_CODES = Object.keys(REGISTRY) as ReadonlyArray<string>;

/**
 * Resolve the adapter for a carrier-row or a bare code string. Returns `null`
 * for an unknown/unregistered code (e.g. 'dhl') so the caller can answer a clean
 * 422 instead of throwing.
 */
export function getShipmentAdapter(
  carrierOrCode: ShippingCarrier | string,
): ShipmentAdapter | null {
  const code = typeof carrierOrCode === 'string' ? carrierOrCode : carrierOrCode.code;
  return REGISTRY[code] ?? null;
}

export { sendcloudAdapter, myparcelAdapter, postnlAdapter };
