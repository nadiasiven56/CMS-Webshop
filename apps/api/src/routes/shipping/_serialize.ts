/**
 * Serializers — Drizzle-row → API-DTO voor de shipping-module.
 *
 * KRITISCH: credentials worden NOOIT raw teruggegeven. We tonen alleen een
 * presence-map via {@link maskCredentials} (`{ apiKey: 'set' | null, ... }`),
 * zodat de UI kan zien WELKE velden ingevuld zijn zonder de geheimen te lekken.
 *
 * Conventie (zie channels/_serialize.ts):
 *   - timestamps → ISO-string
 *   - jsonb (config / raw) shape stabiel houden
 */
import type { ShippingCarrier, Shipment } from '../../db/schema/shipping.js';
import { decryptCredentials, maskCredentials } from '../../lib/channel-crypto.js';

export interface CarrierDto {
  id: string;
  code: string;
  name: string;
  status: string;
  /** Presence-map per credential-veld — NOOIT de raw waarde. */
  credentials: Record<string, 'set' | null>;
  /** True als er ueberhaupt versleutelde credentials zijn opgeslagen. */
  hasCredentials: boolean;
  config: Record<string, unknown>;
  lastTestAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Detail-DTO = list-DTO + counts van shipments. */
export interface CarrierDetailDto extends CarrierDto {
  counts: {
    shipments: number;
  };
}

/**
 * Decrypt-in-memory → mask. De decrypted waarden verlaten deze functie NOOIT;
 * we geven enkel de presence-map terug. Bij niet-ontsleutelbare/lege creds is
 * de map leeg ({}).
 */
function maskedCreds(carrier: ShippingCarrier): Record<string, 'set' | null> {
  const decrypted = decryptCredentials(
    (carrier.credentials ?? null) as { enc: string } | null,
  );
  return maskCredentials(decrypted);
}

export function toCarrierDto(carrier: ShippingCarrier): CarrierDto {
  return {
    id: carrier.id,
    code: carrier.code,
    name: carrier.name,
    status: carrier.status,
    credentials: maskedCreds(carrier),
    hasCredentials: carrier.credentials != null,
    config: (carrier.config ?? {}) as Record<string, unknown>,
    lastTestAt: carrier.lastTestAt ? carrier.lastTestAt.toISOString() : null,
    createdAt: carrier.createdAt.toISOString(),
    updatedAt: carrier.updatedAt.toISOString(),
  };
}

export function toCarrierDetailDto(
  carrier: ShippingCarrier,
  counts: { shipments: number },
): CarrierDetailDto {
  return {
    ...toCarrierDto(carrier),
    counts,
  };
}

// ─── shipments ───────────────────────────────────────────────

export interface ShipmentDto {
  id: string;
  orderId: string;
  carrierId: string | null;
  carrierCode: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  status: string;
  weightGrams: number | null;
  raw: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export function toShipmentDto(s: Shipment): ShipmentDto {
  return {
    id: s.id,
    orderId: s.orderId,
    carrierId: s.carrierId,
    carrierCode: s.carrierCode,
    trackingCode: s.trackingCode,
    trackingUrl: s.trackingUrl,
    labelUrl: s.labelUrl,
    status: s.status,
    weightGrams: s.weightGrams,
    raw: (s.raw ?? null) as Record<string, unknown> | null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
