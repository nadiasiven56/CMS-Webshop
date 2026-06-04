/**
 * SendcloudAdapter — turnkey, CONNECT-READY adapter for the Sendcloud API v2.
 *
 * Implements the OFFICIAL Sendcloud contract (HTTP Basic auth with public+secret
 * key, base https://panel.sendcloud.sc/api/v2, POST /parcels to create a label,
 * GET /tracking/{code}) but is READY UP TO THE KEY-ENTRY POINT: nothing live ever
 * fires without credentials. Every network-touching method first calls the
 * private `requireCreds()` guard, which throws a typed
 * {@link CarrierNotConnectedError} ('Sendcloud credentials required') when the
 * carrier is not `status='connected'` or the publicKey/secretKey are empty. Once
 * the operator wires real keys and flips the carrier to connected, these methods
 * call the real endpoints.
 *
 * Credentials shape (stored encrypted, decrypted in-memory by the route):
 *   { publicKey: string, secretKey: string }
 */
import type { ShippingCarrier } from '../../../db/schema/shipping.js';
import { decryptCredentials } from '../../../lib/channel-crypto.js';
import {
  CarrierNotConnectedError,
  type CreateLabelResult,
  type RateInput,
  type ShipmentAdapter,
  type ShipmentLabelInput,
  type ShipmentRate,
  type TrackingEvent,
  type TrackingResult,
  type VerifyResult,
} from './types.js';

const SENDCLOUD_BASE = 'https://panel.sendcloud.sc/api/v2';

interface SendcloudCredentials {
  publicKey: string;
  secretKey: string;
}

export class SendcloudAdapter implements ShipmentAdapter {
  readonly code = 'sendcloud';

  /**
   * Guard: returns the decrypted credentials only when the carrier is connected
   * and has both publicKey + secretKey. Otherwise throws the typed not-connected
   * error so NO live request can fire.
   */
  private requireCreds(carrier: ShippingCarrier): SendcloudCredentials {
    if (carrier.status !== 'connected') {
      throw new CarrierNotConnectedError('Sendcloud credentials required');
    }
    const creds = decryptCredentials(
      (carrier.credentials ?? null) as { enc: string } | null,
    );
    const publicKey = creds && typeof creds.publicKey === 'string' ? creds.publicKey : '';
    const secretKey = creds && typeof creds.secretKey === 'string' ? creds.secretKey : '';
    if (!publicKey || !secretKey) {
      throw new CarrierNotConnectedError('Sendcloud credentials required');
    }
    return { publicKey, secretKey };
  }

  /** Basic-auth header from public+secret key. */
  private authHeader(creds: SendcloudCredentials): string {
    const token = Buffer.from(`${creds.publicKey}:${creds.secretKey}`).toString('base64');
    return `Basic ${token}`;
  }

  /**
   * verifyConnection never throws — converts the not-connected guard into a clean
   * {ok:false}. When connected it hits a cheap authenticated endpoint to prove the
   * keys are valid.
   */
  async verifyConnection(carrier: ShippingCarrier): Promise<VerifyResult> {
    let creds: SendcloudCredentials;
    try {
      creds = this.requireCreds(carrier);
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Sendcloud credentials required',
      };
    }
    try {
      const res = await fetch(`${SENDCLOUD_BASE}/user`, {
        method: 'GET',
        headers: { Authorization: this.authHeader(creds), Accept: 'application/json' },
      });
      if (!res.ok) {
        return { ok: false, detail: `Sendcloud HTTP ${res.status}` };
      }
      return { ok: true, detail: 'Sendcloud API v2 verbonden' };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'sendcloud connection failed',
      };
    }
  }

  /**
   * Create a parcel + label. POST /parcels with `request_label: true` so
   * Sendcloud returns a label url + tracking number in one call.
   */
  async createLabel(
    carrier: ShippingCarrier,
    input: ShipmentLabelInput,
  ): Promise<CreateLabelResult> {
    const creds = this.requireCreds(carrier);
    const res = await fetch(`${SENDCLOUD_BASE}/parcels`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(creds),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        parcel: {
          name: input.toAddress.name,
          company_name: input.toAddress.company ?? '',
          address: input.toAddress.street,
          address_2: input.toAddress.street2 ?? '',
          house_number: '',
          city: input.toAddress.city,
          postal_code: input.toAddress.postalCode,
          country: input.toAddress.country,
          email: input.toAddress.email ?? '',
          telephone: input.toAddress.phone ?? '',
          weight: (input.weightGrams / 1000).toFixed(3), // Sendcloud expects kg as string
          order_number: input.orderReference,
          request_label: true,
          ...(input.service ? { shipment: { name: input.service } } : {}),
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Sendcloud createLabel HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const parcel = (raw.parcel ?? {}) as Record<string, unknown>;
    const label = (parcel.label ?? {}) as Record<string, unknown>;
    return {
      trackingCode: typeof parcel.tracking_number === 'string' ? parcel.tracking_number : '',
      trackingUrl: typeof parcel.tracking_url === 'string' ? parcel.tracking_url : '',
      labelUrl:
        typeof label.normal_printer === 'string'
          ? label.normal_printer
          : typeof label.label_printer === 'string'
            ? label.label_printer
            : '',
      raw,
    };
  }

  /** Fetch tracking for a tracking code. GET /tracking/{code}. */
  async getTracking(
    carrier: ShippingCarrier,
    trackingCode: string,
  ): Promise<TrackingResult> {
    const creds = this.requireCreds(carrier);
    const res = await fetch(
      `${SENDCLOUD_BASE}/tracking/${encodeURIComponent(trackingCode)}`,
      {
        method: 'GET',
        headers: { Authorization: this.authHeader(creds), Accept: 'application/json' },
      },
    );
    if (!res.ok) {
      throw new Error(`Sendcloud getTracking HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const statuses = Array.isArray(raw.statuses)
      ? (raw.statuses as Record<string, unknown>[])
      : [];
    const events: TrackingEvent[] = statuses.map((s) => ({
      at: typeof s.carrier_update_timestamp === 'string' ? s.carrier_update_timestamp : '',
      status: typeof s.parent_status === 'string' ? s.parent_status : String(s.status ?? ''),
      description: typeof s.carrier_message === 'string' ? s.carrier_message : '',
    }));
    const latest = events.at(-1);
    return {
      status: latest?.status ?? 'pending',
      events,
      raw,
    };
  }

  /** Optional: quote shipping methods for a destination. */
  async getRates(
    carrier: ShippingCarrier,
    input: RateInput,
  ): Promise<ShipmentRate[]> {
    const creds = this.requireCreds(carrier);
    const params = new URLSearchParams({
      to_country: input.toAddress.country,
      from_country: input.toAddress.country,
      weight: (input.weightGrams / 1000).toFixed(3),
      weight_unit: 'kilogram',
    });
    const res = await fetch(`${SENDCLOUD_BASE}/shipping-price?${params.toString()}`, {
      method: 'GET',
      headers: { Authorization: this.authHeader(creds), Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Sendcloud getRates HTTP ${res.status}`);
    }
    const raw = (await res.json()) as unknown;
    const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
    return list.map((r) => ({
      service: typeof r.shipping_method_name === 'string' ? r.shipping_method_name : 'Sendcloud',
      priceString: typeof r.price === 'string' ? r.price : String(r.price ?? '0'),
      currency: typeof r.currency === 'string' ? r.currency : 'EUR',
    }));
  }
}

export const sendcloudAdapter = new SendcloudAdapter();
