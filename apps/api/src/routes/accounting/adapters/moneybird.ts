/**
 * MoneybirdAdapter — CONNECT-READY adapter for the Moneybird API v2.
 *
 * Implements the OFFICIAL Moneybird contract (Bearer OAuth access-token,
 * per-administration base URL, JSON sales-invoice create) but is READY UP TO THE
 * KEY-ENTRY POINT: nothing live ever fires without credentials. Every
 * network-touching method first calls the private `requireCreds()` guard, which
 * throws a typed {@link AccountingNotConnectedError} ('Moneybird credentials
 * required') when the connection is not `status='connected'` or the accessToken
 * is empty. Once the operator wires a real token and flips the connection to
 * connected, these methods call the real endpoints.
 *
 * Credentials shape (stored encrypted, decrypted in-memory by the route):
 *   { accessToken: string }
 * Config (plain jsonb on the connection):
 *   { administrationId: string, ledgerMappings?: Record<string, string> }
 *
 * Auth: Bearer <accessToken> against
 *   https://moneybird.com/api/v2/{administration_id}
 * Endpoints used:
 *   - GET  /administrations.json        (verify / list administrations)
 *   - POST /sales_invoices.json         (create a sales invoice)
 */
import type { AccountingConnection } from '../../../db/schema/accounting.js';
import { decryptCredentials } from '../../../lib/channel-crypto.js';
import {
  AccountingNotConnectedError,
  type AccountingAdapter,
  type AccountingAdministration,
  type AccountingInvoiceInput,
  type AccountingPushResult,
  type AccountingVerifyResult,
} from './types.js';

const BASE = 'https://moneybird.com/api/v2';
const VERSION_NOTE = 'Moneybird API v2';

interface MoneybirdContext {
  accessToken: string;
  administrationId: string;
}

export class MoneybirdAdapter implements AccountingAdapter {
  readonly provider = 'moneybird';

  /**
   * Guard: returns the decrypted access-token + administration id only when the
   * connection is connected and both are present. Otherwise throws the typed
   * not-connected error so NO live request can fire.
   */
  private requireCreds(conn: AccountingConnection): MoneybirdContext {
    if (conn.status !== 'connected') {
      throw new AccountingNotConnectedError('Moneybird credentials required');
    }
    const creds = decryptCredentials(
      (conn.credentials ?? null) as { enc: string } | null,
    );
    const accessToken =
      creds && typeof creds.accessToken === 'string' ? creds.accessToken : '';
    const cfg = (conn.config ?? {}) as { administrationId?: unknown };
    const administrationId =
      typeof cfg.administrationId === 'string' ? cfg.administrationId : '';
    if (!accessToken || !administrationId) {
      throw new AccountingNotConnectedError('Moneybird credentials required');
    }
    return { accessToken, administrationId };
  }

  /** Base URL bound to the configured administration. */
  private baseUrl(ctx: MoneybirdContext): string {
    return `${BASE}/${encodeURIComponent(ctx.administrationId)}`;
  }

  /** Authorized fetch against the Moneybird API. Throws on non-2xx. */
  private async request<T>(
    ctx: MoneybirdContext,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl(ctx)}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`moneybird ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  async verifyConnection(
    conn: AccountingConnection,
  ): Promise<AccountingVerifyResult> {
    let ctx: MoneybirdContext;
    try {
      ctx = this.requireCreds(conn);
    } catch (err) {
      return {
        ok: false,
        detail:
          err instanceof Error ? err.message : 'Moneybird credentials required',
      };
    }
    try {
      // Cheap proof the token + administration are valid.
      await this.request(ctx, '/sales_invoices.json?per_page=1');
      return { ok: true, detail: `${VERSION_NOTE} verbonden` };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'moneybird connection failed',
      };
    }
  }

  async pushInvoice(
    conn: AccountingConnection,
    invoice: AccountingInvoiceInput,
  ): Promise<AccountingPushResult> {
    const ctx = this.requireCreds(conn);
    const body = {
      sales_invoice: {
        reference: invoice.number,
        invoice_date: invoice.date,
        currency: invoice.currency,
        contact: {
          company_name: invoice.customer.name,
          send_invoices_to_email: invoice.customer.email ?? undefined,
          address1: invoice.customer.address ?? undefined,
        },
        details_attributes: invoice.lines.map((l) => ({
          description: l.description,
          amount: String(l.quantity),
          price: l.unitPriceString,
          tax_rate_percentage: l.vatRateString,
        })),
      },
    };
    const raw = await this.request<Record<string, unknown>>(
      ctx,
      '/sales_invoices.json',
      { method: 'POST', body },
    );
    return { externalId: String(raw.id ?? ''), raw };
  }

  async listAdministrations(
    conn: AccountingConnection,
  ): Promise<AccountingAdministration[]> {
    const ctx = this.requireCreds(conn);
    // /administrations.json is NOT administration-scoped — hit the root host.
    const res = await fetch(`${BASE}/administrations.json`, {
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`moneybird ${res.status}: ${text.slice(0, 300)}`);
    }
    const list = (await res.json()) as Array<Record<string, unknown>>;
    return (Array.isArray(list) ? list : []).map((a) => ({
      id: String(a.id ?? ''),
      name: typeof a.name === 'string' ? a.name : String(a.id ?? ''),
    }));
  }
}

export const moneybirdAdapter = new MoneybirdAdapter();
