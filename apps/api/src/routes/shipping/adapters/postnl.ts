/**
 * PostNLAdapter — turnkey, CONNECT-READY adapter for the PostNL API.
 *
 * Implements the OFFICIAL PostNL contract (`apikey` header auth, production base
 * https://api.postnl.nl, sandbox https://api-sandbox.postnl.nl, the Shipping
 * (label) and Shipment/Status (tracking) endpoints) but is READY UP TO THE
 * KEY-ENTRY POINT: nothing live ever fires without credentials. Every
 * network-touching method first calls the private `requireCreds()` guard, which
 * throws a typed {@link CarrierNotConnectedError} ('PostNL credentials required')
 * when the carrier is not `status='connected'` or the apiKey/customerCode/
 * customerNumber are empty.
 *
 * Credentials shape (stored encrypted, decrypted in-memory by the route):
 *   { apiKey: string, customerCode: string, customerNumber: string }
 * Config (plain jsonb on the carrier):
 *   { environment?: 'sandbox' | 'production' }   // defaults to 'sandbox'
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

const POSTNL_BASE_PRODUCTION = 'https://api.postnl.nl';
const POSTNL_BASE_SANDBOX = 'https://api-sandbox.postnl.nl';

interface PostNLCredentials {
  apiKey: string;
  customerCode: string;
  customerNumber: string;
}

type PostNLEnvironment = 'sandbox' | 'production';

interface PostNLContext {
  creds: PostNLCredentials;
  baseUrl: string;
}

export class PostNLAdapter implements ShipmentAdapter {
  readonly code = 'postnl';

  /**
   * Guard: returns the decrypted credentials + resolved base URL only when the
   * carrier is connected and has apiKey + customerCode + customerNumber.
   * Otherwise throws the typed not-connected error so NO live request can fire.
   */
  private requireCreds(carrier: ShippingCarrier): PostNLContext {
    if (carrier.status !== 'connected') {
      throw new CarrierNotConnectedError('PostNL credentials required');
    }
    const creds = decryptCredentials(
      (carrier.credentials ?? null) as { enc: string } | null,
    );
    const apiKey = creds && typeof creds.apiKey === 'string' ? creds.apiKey : '';
    const customerCode =
      creds && typeof creds.customerCode === 'string' ? creds.customerCode : '';
    const customerNumber =
      creds && typeof creds.customerNumber === 'string' ? creds.customerNumber : '';
    if (!apiKey || !customerCode || !customerNumber) {
      throw new CarrierNotConnectedError('PostNL credentials required');
    }
    return {
      creds: { apiKey, customerCode, customerNumber },
      baseUrl: this.resolveBaseUrl(carrier),
    };
  }

  /** Read config.environment, defaulting to 'sandbox' until the operator flips it. */
  private resolveEnvironment(carrier: ShippingCarrier): PostNLEnvironment {
    const cfg = (carrier.config ?? {}) as { environment?: unknown };
    return cfg.environment === 'production' ? 'production' : 'sandbox';
  }

  private resolveBaseUrl(carrier: ShippingCarrier): string {
    return this.resolveEnvironment(carrier) === 'production'
      ? POSTNL_BASE_PRODUCTION
      : POSTNL_BASE_SANDBOX;
  }

  /**
   * verifyConnection never throws — converts the not-connected guard into a clean
   * {ok:false}. When connected it hits a cheap authenticated endpoint to prove the
   * key is valid.
   */
  async verifyConnection(carrier: ShippingCarrier): Promise<VerifyResult> {
    let ctx: PostNLContext;
    try {
      ctx = this.requireCreds(carrier);
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'PostNL credentials required',
      };
    }
    try {
      // Locations endpoint is a cheap authenticated GET that proves the apikey.
      const params = new URLSearchParams({
        CountryCode: 'NL',
        PostalCode: '2132WT',
      });
      const res = await fetch(
        `${ctx.baseUrl}/shipment/v2_1/locations/nearest?${params.toString()}`,
        { method: 'GET', headers: { apikey: ctx.creds.apiKey, Accept: 'application/json' } },
      );
      if (!res.ok) {
        return { ok: false, detail: `PostNL HTTP ${res.status}` };
      }
      return {
        ok: true,
        detail: `PostNL API (${this.resolveEnvironment(carrier)}) verbonden`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'postnl connection failed',
      };
    }
  }

  /**
   * Create a shipment + label. POST /shipment/v2_2/label with the customer
   * envelope. PostNL returns a base64 label PDF; we surface the barcode as the
   * tracking code.
   */
  async createLabel(
    carrier: ShippingCarrier,
    input: ShipmentLabelInput,
  ): Promise<CreateLabelResult> {
    const ctx = this.requireCreds(carrier);
    const res = await fetch(`${ctx.baseUrl}/shipment/v2_2/label`, {
      method: 'POST',
      headers: {
        apikey: ctx.creds.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        Customer: {
          CustomerCode: ctx.creds.customerCode,
          CustomerNumber: ctx.creds.customerNumber,
        },
        Message: {
          MessageID: input.orderReference,
          Printertype: 'GraphicFile|PDF',
        },
        Shipments: [
          {
            Addresses: [
              {
                AddressType: '01', // 01 = receiver
                Name: input.toAddress.name,
                CompanyName: input.toAddress.company ?? '',
                Street: input.toAddress.street,
                Zipcode: input.toAddress.postalCode,
                City: input.toAddress.city,
                Countrycode: input.toAddress.country,
              },
            ],
            Contacts: [
              {
                ContactType: '01',
                Email: input.toAddress.email ?? '',
                SMSNr: input.toAddress.phone ?? '',
              },
            ],
            Dimension: { Weight: String(Math.max(1, Math.trunc(input.weightGrams))) },
            ProductCodeDelivery: input.service ?? '3085', // 3085 = standard parcel NL
            Reference: input.orderReference,
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`PostNL createLabel HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const responseShipments = Array.isArray(raw.ResponseShipments)
      ? (raw.ResponseShipments as Record<string, unknown>[])
      : [];
    const first = (responseShipments[0] ?? {}) as Record<string, unknown>;
    const barcode = typeof first.Barcode === 'string' ? first.Barcode : '';
    const labels = Array.isArray(first.Labels)
      ? (first.Labels as Record<string, unknown>[])
      : [];
    const labelContent = (labels[0] ?? {}) as Record<string, unknown>;
    return {
      trackingCode: barcode,
      trackingUrl: barcode
        ? `https://postnl.nl/tracktrace/?B=${encodeURIComponent(barcode)}&P=${encodeURIComponent(input.toAddress.postalCode)}&D=${encodeURIComponent(input.toAddress.country)}`
        : '',
      // PostNL returns the label inline as base64 (Content); the route persists
      // raw so the PDF can be re-extracted. labelUrl is a data-URI placeholder.
      labelUrl:
        typeof labelContent.Content === 'string'
          ? `data:application/pdf;base64,${labelContent.Content}`
          : '',
      raw,
    };
  }

  /** Fetch tracking. GET /shipment/v2/status/barcode/{code}. */
  async getTracking(
    carrier: ShippingCarrier,
    trackingCode: string,
  ): Promise<TrackingResult> {
    const ctx = this.requireCreds(carrier);
    const params = new URLSearchParams({ customerNumber: ctx.creds.customerNumber });
    const res = await fetch(
      `${ctx.baseUrl}/shipment/v2/status/barcode/${encodeURIComponent(trackingCode)}?${params.toString()}`,
      { method: 'GET', headers: { apikey: ctx.creds.apiKey, Accept: 'application/json' } },
    );
    if (!res.ok) {
      throw new Error(`PostNL getTracking HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const currentStatus = (raw.CurrentStatus ?? {}) as Record<string, unknown>;
    const shipment = (currentStatus.Shipment ?? {}) as Record<string, unknown>;
    const eventArr = Array.isArray(shipment.Event)
      ? (shipment.Event as Record<string, unknown>[])
      : [];
    const events: TrackingEvent[] = eventArr.map((e) => ({
      at: typeof e.TimeStamp === 'string' ? e.TimeStamp : '',
      status: typeof e.Code === 'string' ? e.Code : String(e.Status ?? ''),
      description: typeof e.Description === 'string' ? e.Description : '',
    }));
    const status = (shipment.Status ?? {}) as Record<string, unknown>;
    return {
      status:
        typeof status.StatusCode === 'string'
          ? status.StatusCode
          : (events.at(-1)?.status ?? 'pending'),
      events,
      raw,
    };
  }
}

export const postnlAdapter = new PostNLAdapter();
