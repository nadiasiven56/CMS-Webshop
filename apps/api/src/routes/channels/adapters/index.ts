/**
 * Adapter registry — resolves a channel (or a bare type string) to its
 * concrete {@link ChannelAdapter}.
 *
 * Supported types:
 *   - own_webshop → REAL first-party storefront adapter (no external creds).
 *   - bol         → CONNECT-READY bol.com Retailer API v10 adapter.
 *   - amazon      → CONNECT-READY Amazon SP-API adapter.
 *   - gmc         → CONNECT-READY Google Merchant Center adapter (scaffold).
 *
 * The route-layer always goes through `getAdapter()` so it never hard-codes a
 * specific marketplace SDK.
 */
import type { Channel } from '../../../db/schema/channels.js';
import { decryptCredentials } from '../../../lib/channel-crypto.js';
import { ownWebshopAdapter } from './own-webshop.js';
import { bolAdapter } from './bol.js';
import { amazonAdapter } from './amazon.js';
import {
  ChannelNotConnectedError,
  type ChannelAdapter,
  type NormalizedOrder,
  type PublishableVariant,
  type PushListingResult,
  type ShipmentInput,
  type VerifyResult,
} from './types.js';

/**
 * GmcAdapter — CONNECT-READY Google Merchant Center adapter (scaffold).
 *
 * GMC is a feed/listing channel: it has no inbound orders, so `fetchOrders`
 * returns []. Listing/inventory pushes are guarded behind a credentials check
 * (Content API for Shopping service-account JSON), so nothing live fires
 * without credentials. Mirrors the bol/amazon guard pattern.
 *
 * Credentials shape: { merchantId: string, serviceAccountJson: string }
 */
class GmcAdapter implements ChannelAdapter {
  readonly type = 'gmc';

  private requireCreds(channel: Channel): { merchantId: string } {
    if (channel.status !== 'connected') {
      throw new ChannelNotConnectedError('Google Merchant Center credentials required');
    }
    const creds = decryptCredentials(
      (channel.credentials ?? null) as { enc: string } | null,
    );
    const merchantId =
      creds && typeof creds.merchantId === 'string' ? creds.merchantId : '';
    const serviceAccountJson =
      creds && typeof creds.serviceAccountJson === 'string'
        ? creds.serviceAccountJson
        : '';
    if (!merchantId || !serviceAccountJson) {
      throw new ChannelNotConnectedError('Google Merchant Center credentials required');
    }
    return { merchantId };
  }

  async verifyConnection(channel: Channel): Promise<VerifyResult> {
    try {
      this.requireCreds(channel);
    } catch (err) {
      return {
        ok: false,
        detail:
          err instanceof Error
            ? err.message
            : 'Google Merchant Center credentials required',
      };
    }
    // Real Content-API account-info call would go here once creds are wired.
    return { ok: true, detail: 'Google Merchant Center credentials present.' };
  }

  async fetchOrders(_channel: Channel): Promise<NormalizedOrder[]> {
    // GMC is a listing feed — it produces no inbound orders.
    return [];
  }

  async acknowledgeOrder(channel: Channel, _externalId: string): Promise<void> {
    this.requireCreds(channel);
  }

  async submitShipment(
    channel: Channel,
    _externalId: string,
    _shipment: ShipmentInput,
  ): Promise<void> {
    this.requireCreds(channel);
  }

  async pushListing(
    channel: Channel,
    variant: PublishableVariant,
  ): Promise<PushListingResult> {
    this.requireCreds(channel);
    // Content API products.insert would go here once creds are wired.
    return { externalId: variant.sku ?? variant.variantId };
  }

  async updateInventory(
    channel: Channel,
    _variantId: string,
    _available: number,
  ): Promise<void> {
    this.requireCreds(channel);
  }

  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    return {
      externalId: String(raw.id ?? ''),
      channelType: this.type,
      email: null,
      currency: 'EUR',
      placedAt: null,
      items: [],
      raw,
    };
  }
}

export const gmcAdapter = new GmcAdapter();

const REGISTRY: Record<string, ChannelAdapter> = {
  own_webshop: ownWebshopAdapter,
  bol: bolAdapter,
  amazon: amazonAdapter,
  gmc: gmcAdapter,
};

/** All channel types that have a registered adapter. */
export const SUPPORTED_CHANNEL_TYPES = Object.keys(REGISTRY) as ReadonlyArray<string>;

/**
 * Resolve the adapter for a channel-row or a bare type string. Returns `null`
 * for an unknown type so the caller can answer a clean 400/422 instead of
 * throwing.
 */
export function getAdapter(channelOrType: Channel | string): ChannelAdapter | null {
  const type = typeof channelOrType === 'string' ? channelOrType : channelOrType.type;
  return REGISTRY[type] ?? null;
}

export { ownWebshopAdapter, bolAdapter, amazonAdapter };
