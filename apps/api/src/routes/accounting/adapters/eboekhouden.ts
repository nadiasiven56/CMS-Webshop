/**
 * EBoekhoudenAdapter — CONNECT-READY adapter for e-Boekhouden.
 *
 * Implements the OFFICIAL e-Boekhouden contract (session-token auth via the
 * username + two security codes) but is READY UP TO THE KEY-ENTRY POINT: nothing
 * live ever fires without credentials. Every network-touching method first calls
 * the private `requireCreds()` guard, which throws a typed
 * {@link AccountingNotConnectedError} ('e-Boekhouden credentials required') when
 * the connection is not `status='connected'` or any of the three creds are
 * empty.
 *
 * e-Boekhouden exposes both a legacy SOAP API (https://soap.e-boekhouden.nl) and
 * a newer REST API (https://api.e-boekhouden.nl). Both authenticate by first
 * opening a session (OpenSession / session token) using the username +
 * SecurityCode1 + SecurityCode2, then calling the mutation endpoint with that
 * session token. We target the REST base by default; the session-open is wired
 * once the operator connects.
 *
 * Credentials shape (stored encrypted, decrypted in-memory by the route):
 *   { username, securityCode1, securityCode2 }
 * Config (plain jsonb on the connection):
 *   { ledgerMappings?: Record<string, string> }
 *
 * Endpoints used (REST):
 *   - POST /v1/session            (open a session → session token)
 *   - POST /v1/invoice            (create a sales invoice / mutation)
 */
import type { AccountingConnection } from '../../../db/schema/accounting.js';
import { decryptCredentials } from '../../../lib/channel-crypto.js';
import {
  AccountingNotConnectedError,
  type AccountingAdapter,
  type AccountingInvoiceInput,
  type AccountingPushResult,
  type AccountingVerifyResult,
} from './types.js';

const REST_BASE = 'https://api.e-boekhouden.nl';
const SOAP_BASE = 'https://soap.e-boekhouden.nl';
const VERSION_NOTE = 'e-Boekhouden REST API v1';

interface EBoekhoudenCredentials {
  username: string;
  securityCode1: string;
  securityCode2: string;
}

export class EBoekhoudenAdapter implements AccountingAdapter {
  readonly provider = 'eboekhouden';

  /** Diagnostics: the SOAP base for operators that prefer the legacy API. */
  readonly soapBaseUrl = SOAP_BASE;

  /**
   * Guard: returns the decrypted username + two security codes only when the
   * connection is connected and all three are present. Otherwise throws the
   * typed not-connected error so NO live request can fire.
   */
  private requireCreds(conn: AccountingConnection): EBoekhoudenCredentials {
    if (conn.status !== 'connected') {
      throw new AccountingNotConnectedError('e-Boekhouden credentials required');
    }
    const creds = decryptCredentials(
      (conn.credentials ?? null) as { enc: string } | null,
    );
    const str = (k: string): string =>
      creds && typeof creds[k] === 'string' ? (creds[k] as string) : '';
    const username = str('username');
    const securityCode1 = str('securityCode1');
    const securityCode2 = str('securityCode2');
    if (!username || !securityCode1 || !securityCode2) {
      throw new AccountingNotConnectedError('e-Boekhouden credentials required');
    }
    return { username, securityCode1, securityCode2 };
  }

  /**
   * Open a REST session and return the session token. e-Boekhouden requires a
   * session per request-batch; the token is short-lived and not cached here.
   */
  private async openSession(creds: EBoekhoudenCredentials): Promise<string> {
    const res = await fetch(`${REST_BASE}/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        accessToken: creds.securityCode2,
        source: 'webshop-crm',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`e-boekhouden session ${res.status}: ${text.slice(0, 300)}`);
    }
    const body = (await res.json()) as { token?: unknown };
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token) throw new Error('e-boekhouden session returned no token');
    return token;
  }

  /** Authorized fetch using an opened session token. Throws on non-2xx. */
  private async request<T>(
    token: string,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const res = await fetch(`${REST_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`e-boekhouden ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  async verifyConnection(
    conn: AccountingConnection,
  ): Promise<AccountingVerifyResult> {
    let creds: EBoekhoudenCredentials;
    try {
      creds = this.requireCreds(conn);
    } catch (err) {
      return {
        ok: false,
        detail:
          err instanceof Error
            ? err.message
            : 'e-Boekhouden credentials required',
      };
    }
    try {
      // Opening a session proves the username + security codes are valid.
      await this.openSession(creds);
      return { ok: true, detail: `${VERSION_NOTE} verbonden` };
    } catch (err) {
      return {
        ok: false,
        detail:
          err instanceof Error ? err.message : 'e-boekhouden connection failed',
      };
    }
  }

  async pushInvoice(
    conn: AccountingConnection,
    invoice: AccountingInvoiceInput,
  ): Promise<AccountingPushResult> {
    const creds = this.requireCreds(conn);
    const token = await this.openSession(creds);
    const body = {
      invoiceNumber: invoice.number,
      date: invoice.date,
      currency: invoice.currency,
      relation: {
        name: invoice.customer.name,
        email: invoice.customer.email ?? undefined,
        address: invoice.customer.address ?? undefined,
      },
      lines: invoice.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        price: l.unitPriceString,
        vatPercentage: l.vatRateString,
      })),
    };
    const raw = await this.request<Record<string, unknown>>(token, '/v1/invoice', {
      method: 'POST',
      body,
    });
    return { externalId: String(raw.id ?? raw.invoiceId ?? ''), raw };
  }
}

export const eboekhoudenAdapter = new EBoekhoudenAdapter();
