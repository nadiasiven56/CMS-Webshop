/**
 * Serializers — Drizzle-row → API-DTO voor de channels-module.
 *
 * KRITISCH: credentials worden NOOIT raw teruggegeven. We tonen alleen een
 * presence-map via {@link maskCredentials} (`{ clientId: 'set' | null, ... }`),
 * zodat de UI kan zien WELKE velden ingevuld zijn zonder de geheimen te lekken.
 *
 * Conventie (zie shops/_serialize.ts):
 *   - timestamps → ISO-string
 *   - numeric (price_override) blijft string (Money), nooit number
 *   - jsonb (config) shape stabiel houden
 */
import type { Channel } from '../../db/schema/channels.js';
import type { ChannelProduct } from '../../db/schema/channel-products.js';
import type { ChannelOrder } from '../../db/schema/channel-orders.js';
import { decryptCredentials, maskCredentials } from '../../lib/channel-crypto.js';

export interface ChannelDto {
  id: string;
  type: string;
  name: string;
  status: string;
  /** Presence-map per credential-veld — NOOIT de raw waarde. */
  credentials: Record<string, 'set' | null>;
  /** True als er ueberhaupt versleutelde credentials zijn opgeslagen. */
  hasCredentials: boolean;
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Detail-DTO = list-DTO + counts van channel_products/channel_orders. */
export interface ChannelDetailDto extends ChannelDto {
  counts: {
    products: number;
    orders: number;
  };
}

/**
 * Decrypt-in-memory → mask. De decrypted waarden verlaten deze functie NOOIT;
 * we geven enkel de presence-map terug. Bij niet-ontsleutelbare/lege creds is
 * de map leeg ({}).
 */
function maskedCreds(channel: Channel): Record<string, 'set' | null> {
  const decrypted = decryptCredentials(
    (channel.credentials ?? null) as { enc: string } | null,
  );
  return maskCredentials(decrypted);
}

export function toChannelDto(c: Channel): ChannelDto {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    status: c.status,
    credentials: maskedCreds(c),
    hasCredentials: c.credentials != null,
    config: (c.config ?? {}) as Record<string, unknown>,
    lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toChannelDetailDto(
  c: Channel,
  counts: { products: number; orders: number },
): ChannelDetailDto {
  return {
    ...toChannelDto(c),
    counts,
  };
}

// ─── channel_products ────────────────────────────────────────

export interface ChannelProductDto {
  id: string;
  channelId: string;
  productId: string;
  variantId: string | null;
  externalId: string | null;
  status: string;
  /** Afgeleid uit status: 'active'/'enabled' = listed. */
  enabled: boolean;
  priceOverride: string | null;
  lastSyncedAt: string | null;
  product?: {
    id: string;
    title: string;
    sku: string | null;
  } | null;
}

export function toChannelProductDto(
  cp: ChannelProduct,
  product?: { id: string; title: string; sku: string | null } | null,
): ChannelProductDto {
  const dto: ChannelProductDto = {
    id: cp.id,
    channelId: cp.channelId,
    productId: cp.productId,
    variantId: cp.variantId,
    externalId: cp.externalId,
    status: cp.status,
    enabled: cp.status === 'active' || cp.status === 'enabled' || cp.status === 'listed',
    priceOverride: cp.priceOverride,
    lastSyncedAt: cp.lastSyncedAt ? cp.lastSyncedAt.toISOString() : null,
  };
  if (product !== undefined) dto.product = product;
  return dto;
}

// ─── channel_orders ──────────────────────────────────────────

export interface ChannelOrderDto {
  id: string;
  channelId: string;
  externalOrderId: string | null;
  orderId: string | null;
  raw: Record<string, unknown> | null;
  importedAt: string;
}

export function toChannelOrderDto(co: ChannelOrder): ChannelOrderDto {
  return {
    id: co.id,
    channelId: co.channelId,
    externalOrderId: co.externalOrderId,
    orderId: co.orderId,
    raw: (co.raw ?? null) as Record<string, unknown> | null,
    importedAt: co.importedAt.toISOString(),
  };
}
