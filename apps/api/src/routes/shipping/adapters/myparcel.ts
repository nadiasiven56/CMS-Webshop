/**
 * MyParcelAdapter — turnkey, CONNECT-READY adapter for the MyParcel API.
 *
 * Implements the OFFICIAL MyParcel contract (Bearer API key, base
 * https://api.myparcel.nl, POST /shipments with the versioned media-type header
 * `application/vnd.shipment+json;version=1.1`) but is READY UP TO THE KEY-ENTRY
 * POINT: nothing live ever fires without credentials. Every network-touching
 * method first calls the private `requireCreds()` guard, which throws a typed
 * {@link CarrierNotConnectedError} ('MyParcel credentials required') when the
 * carrier is not `status='connected'` or the apiKey is empty.
 *
 * Credentials shape (stored encrypted, decrypted in-memory by the route):
 *   { apiKey: string }
 *
 * NB: MyParcel authenticates with a base64-encoded API key in the Authorization
 * header (`Authorization: basic base64(apiKey)`). We accept the operator's raw
 * key and base64-encode it here so the stored credential stays the plain key.
 */
import type { ShippingCarrier } from '../../../db/schema/shipping.js';
import { decryptCredentials } from '../../../lib/channel-crypto.js';
import {
  CarrierNotConnectedError,
  type CreateLabelResult,
  type ShipmentAdapter,
  type ShipmentLabelInput,
  type TrackingEvent,
  type TrackingResult,
  type VerifyResult,
} from './types.js';

const MYPARCEL_BASE = 'https://api.myparcel.nl';
const SHIPMENT_MEDIA_TYPE = 'application/vnd.shipment+json;version=1.1';

interface MyParcelCredentials {
  apiKey: string;
}

export class MyParcelAdapter implements ShipmentAdapter {
  readonly code = 'myparcel';

  /**
   * Guard: returns the decrypted credentials only when the carrier is connected
   * and has an apiKey. Otherwise throws the typed not-connected error so NO live
   * request can fire.
   */
  private requireCreds(carrier: ShippingCarrier): MyParcelCredentials {
    if (carrier.status !== 'connected') {
      throw new CarrierNotConnectedError('MyParcel credentials required');
    }
    const creds = decryptCredentials(
      (carrier.credentials ?? null) as { enc: string } | null,
    );
    const apiKey = creds && typeof creds.apiKey === 'string' ? creds.apiKey : '';
    if (!apiKey) {
      throw new CarrierNotConnectedError('MyParcel credentials required');
    }
    return { apiKey };
  }

  /** MyParcel auth header: `basic <base64(apiKey)>`. */
  private authHeader(creds: MyParcelCredentials): string {
    return `basic ${Buffer.from(creds.apiKey).toString('base64')}`;
  }

  /**
   * verifyConnection never throws — converts the not-connected guard into a clean
   * {ok:false}. When connected it hits a cheap authenticated endpoint to prove the
   * key is valid.
   */
  async verifyConnection(carrier: ShippingCarrier): Promise<VerifyResult> {
    let creds: MyParcelCredentials;
    try {
      creds = this.requireCreds(carrier);
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'MyParcel credentials required',
      };
    }
    try {
      const res = await fetch(`${MYPARCEL_BASE}/account`, {
        method: 'GET',
        headers: {
          Authorization: this.authHeader(creds),
          Accept: 'application/json;charset=utf-8',
        },
      });
      if (!res.ok) {
        return { ok: false, detail: `MyParcel HTTP ${res.status}` };
      }
      return { ok: true, detail: 'MyParcel API verbonden' };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'myparcel connection failed',
      };
    }
  }

  /**
   * Create a shipment + label. POST /shipments with the versioned media-type.
   * MyParcel wraps payloads in a `{ data: { shipments: [...] } }` envelope.
   */
  async createLabel(
    carrier: ShippingCarrier,
    input: ShipmentLabelInput,
  ): Promise<CreateLabelResult> {
    const creds = this.requireCreds(carrier);
    const res = await fetch(`${MYPARCEL_BASE}/shipments`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(creds),
        'Content-Type': SHIPMENT_MEDIA_TYPE,
        Accept: 'application/json;charset=utf-8',
      },
      body: JSON.stringify({
        data: {
          shipments: [
            {
              recipient: {
                cc: input.toAddress.country,
                person: input.toAddress.name,
                company: input.toAddress.company ?? '',
                street: input.toAddress.street,
                number: '',
                postal_code: input.toAddress.postalCode,
                city: input.toAddress.city,
                email: input.toAddress.email ?? '',
                phone: input.toAddress.phone ?? '',
              },
              options: {
                package_type: 1, // 1 = parcel
                ...(input.service ? { delivery_type: input.service } : {}),
              },
              physical_properties: {
                weight: Math.max(1, Math.trunc(input.weightGrams)),
              },
              carrier: 1, // 1 = PostNL (MyParcel default carrier id)
              reference_identifier: input.orderReference,
            },
          ],
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`MyParcel createLabel HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const data = (raw.data ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(data.ids) ? (data.ids as Record<string, unknown>[]) : [];
    const first = (ids[0] ?? {}) as Record<string, unknown>;
    const shipmentId = first.id != null ? String(first.id) : '';
    return {
      // MyParcel returns the barcode/label via a follow-up GET; we surface the
      // shipment id as the tracking handle and a deep link to the label PDF.
      trackingCode: typeof first.reference_identifier === 'string'
        ? first.reference_identifier
        : shipmentId,
      trackingUrl: shipmentId ? `${MYPARCEL_BASE}/tracktraces/${shipmentId}` : '',
      labelUrl: shipmentId ? `${MYPARCEL_BASE}/shipment_labels/${shipmentId}` : '',
      raw,
    };
  }

  /** Fetch tracking. GET /tracktraces/{code}. */
  async getTracking(
    carrier: ShippingCarrier,
    trackingCode: string,
  ): Promise<TrackingResult> {
    const creds = this.requireCreds(carrier);
    const res = await fetch(
      `${MYPARCEL_BASE}/tracktraces/${encodeURIComponent(trackingCode)}`,
      {
        method: 'GET',
        headers: {
          Authorization: this.authHeader(creds),
          Accept: 'application/json;charset=utf-8',
        },
      },
    );
    if (!res.ok) {
      throw new Error(`MyParcel getTracking HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const data = (raw.data ?? {}) as Record<string, unknown>;
    const traces = Array.isArray(data.tracktraces)
      ? (data.tracktraces as Record<string, unknown>[])
      : [];
    const first = (traces[0] ?? {}) as Record<string, unknown>;
    const history = Array.isArray(first.history)
      ? (first.history as Record<string, unknown>[])
      : [];
    const events: TrackingEvent[] = history.map((h) => ({
      at: typeof h.time === 'string' ? h.time : '',
      status: typeof h.code === 'string' ? h.code : String(h.status ?? ''),
      description: typeof h.description === 'string' ? h.description : '',
    }));
    const latest = events.at(-1);
    return {
      status: latest?.status ?? 'pending',
      events,
      raw,
    };
  }
}

export const myparcelAdapter = new MyParcelAdapter();
