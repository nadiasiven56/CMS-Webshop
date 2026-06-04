/**
 * ExactOnlineAdapter — CONNECT-READY adapter for the Exact Online REST API v1.
 *
 * Implements the OFFICIAL Exact Online contract (Bearer OAuth2 access-token,
 * per-division base URL, JSON sales-entry create) but is READY UP TO THE
 * KEY-ENTRY POINT: nothing live ever fires without credentials. Every
 * network-touching method first calls the private `requireCreds()` guard, which
 * throws a typed {@link AccountingNotConnectedError} ('Exact Online credentials
 * required') when the connection is not `status='connected'` or the accessToken
 * is empty. The refreshToken/clientId/clientSecret are kept for the eventual
 * token-refresh flow (Exact access-tokens expire after 10 minutes); the refresh
 * itself is wired once the operator connects.
 *
 * Credentials shape (stored encrypted, decrypted in-memory by the route):
 *   { accessToken, refreshToken, clientId, clientSecret }
 * Config (plain jsonb on the connection):
 *   { division: string, ledgerMappings?: Record<string, string> }
 *
 * Auth: Bearer <accessToken> against
 *   https://start.exactonline.nl/api/v1/{division}
 * Endpoints used:
 *   - GET  /salesentry/SalesEntries?$top=1   (verify)
 *   - POST /salesentry/SalesEntries          (create a sales entry)
 *   - GET  /system/Divisions                 (list administrations/divisions)
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

const BASE = 'https://start.exactonline.nl/api/v1';
const VERSION_NOTE = 'Exact Online REST API v1';

interface ExactContext {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  division: string;
}

export class ExactOnlineAdapter implements AccountingAdapter {
  readonly provider = 'exact';

  /**
   * Guard: returns the decrypted OAuth2 tokens + division only when the
   * connection is connected and the accessToken + division are present.
   * Otherwise throws the typed not-connected error so NO live request can fire.
   */
  private requireCreds(conn: AccountingConnection): ExactContext {
    if (conn.status !== 'connected') {
      throw new AccountingNotConnectedError('Exact Online credentials required');
    }
    const creds = decryptCredentials(
      (conn.credentials ?? null) as { enc: string } | null,
    );
    const str = (k: string): string =>
      creds && typeof creds[k] === 'string' ? (creds[k] as string) : '';
    const accessToken = str('accessToken');
    const cfg = (conn.config ?? {}) as { division?: unknown };
    const division = typeof cfg.division === 'string' ? cfg.division : '';
    if (!accessToken || !division) {
      throw new AccountingNotConnectedError('Exact Online credentials required');
    }
    return {
      accessToken,
      refreshToken: str('refreshToken'),
      clientId: str('clientId'),
      clientSecret: str('clientSecret'),
      division,
    };
  }

  /** Base URL bound to the configured division. */
  private baseUrl(ctx: ExactContext): string {
    return `${BASE}/${encodeURIComponent(ctx.division)}`;
  }

  /** Authorized fetch against the Exact Online API. Throws on non-2xx. */
  private async request<T>(
    ctx: ExactContext,
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
      throw new Error(`exact ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  async verifyConnection(
    conn: AccountingConnection,
  ): Promise<AccountingVerifyResult> {
    let ctx: ExactContext;
    try {
      ctx = this.requireCreds(conn);
    } catch (err) {
      return {
        ok: false,
        detail:
          err instanceof Error
            ? err.message
            : 'Exact Online credentials required',
      };
    }
    try {
      await this.request(ctx, '/salesentry/SalesEntries?$top=1');
      return { ok: true, detail: `${VERSION_NOTE} verbonden` };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'exact connection failed',
      };
    }
  }

  async pushInvoice(
    conn: AccountingConnection,
    invoice: AccountingInvoiceInput,
  ): Promise<AccountingPushResult> {
    const ctx = this.requireCreds(conn);
    const body = {
      // Exact expects a SalesEntry with SalesEntryLines; AmountFC fields are
      // numbers. We pass the netto unit price × quantity per line.
      YourRef: invoice.number,
      Currency: invoice.currency,
      EntryDate: `${invoice.date}T00:00:00`,
      SalesEntryLines: invoice.lines.map((l) => ({
        Description: l.description,
        Quantity: l.quantity,
        AmountFC: toNumber(l.unitPriceString) * l.quantity,
        VATPercentage: toNumber(l.vatRateString) / 100,
      })),
    };
    const raw = await this.request<Record<string, unknown>>(
      ctx,
      '/salesentry/SalesEntries',
      { method: 'POST', body },
    );
    const d = (raw.d ?? raw) as Record<string, unknown>;
    return { externalId: String(d.EntryID ?? d.ID ?? ''), raw };
  }

  async listAdministrations(
    conn: AccountingConnection,
  ): Promise<AccountingAdministration[]> {
    const ctx = this.requireCreds(conn);
    const raw = await this.request<{ d?: { results?: Record<string, unknown>[] } }>(
      ctx,
      '/system/Divisions',
    );
    const results = raw?.d?.results ?? [];
    return (Array.isArray(results) ? results : []).map((a) => ({
      id: String(a.Code ?? a.HID ?? ''),
      name:
        typeof a.Description === 'string'
          ? a.Description
          : String(a.Code ?? a.HID ?? ''),
    }));
  }
}

/** Coerce a money STRING to a number for Exact's numeric JSON fields. */
function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export const exactAdapter = new ExactOnlineAdapter();
