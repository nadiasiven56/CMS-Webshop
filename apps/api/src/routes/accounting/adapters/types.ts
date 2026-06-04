/**
 * AccountingAdapter — uniform contract for every external bookkeeping
 * integration (Moneybird / Exact Online / e-Boekhouden).
 *
 * The route-layer never talks to a bookkeeping SDK directly; it talks to an
 * `AccountingAdapter`. Each concrete adapter maps the package's quirks to the
 * CRM's normalized {@link AccountingInvoiceInput} shape.
 *
 * Conventions (mirroring the channels module):
 *   - Money stays a decimal STRING (numeric(12,4) — never a float).
 *   - `verifyConnection` is the only cheap, side-effect-free method safe to call
 *     on demand from the UI ("test connection"); it NEVER throws.
 *   - Every CONNECT-READY adapter guards each network-touching method behind a
 *     private credentials check and surfaces a typed
 *     {@link AccountingNotConnectedError} instead of firing a live request.
 */
import type { AccountingConnection } from '../../../db/schema/accounting.js';

/** A single normalized invoice/sales line as pushed to a bookkeeping package. */
export interface AccountingInvoiceLine {
  /** Human description of the line. */
  description: string;
  /** Whole/decimal units. */
  quantity: number;
  /** Per-unit price ex VAT — money STRING. */
  unitPriceString: string;
  /** VAT rate as a percent STRING (e.g. '21'). */
  vatRateString: string;
}

/** Normalized customer block for an invoice push. */
export interface AccountingInvoiceCustomer {
  name: string;
  email: string | null;
  /** Free-form single-line address snapshot (street/postcode/city/country). */
  address: string | null;
}

/** Per-invoice totals (all money STRINGS). */
export interface AccountingInvoiceTotals {
  /** Net total ex VAT. */
  subtotalString: string;
  /** VAT total. */
  vatTotalString: string;
  /** Gross total incl VAT. */
  totalString: string;
}

/**
 * Channel-agnostic invoice shape an adapter receives. The route builds this from
 * the existing finance `invoices` row (read-only) before handing it to
 * `pushInvoice`, so adapters never need to know the DB schema.
 */
export interface AccountingInvoiceInput {
  /** Invoice number as issued by the CRM (invoices.invoice_number). */
  number: string;
  /** Issue date, ISO-8601 ('YYYY-MM-DD'). */
  date: string;
  /** ISO-4217 currency (e.g. 'EUR'). */
  currency: string;
  customer: AccountingInvoiceCustomer;
  lines: AccountingInvoiceLine[];
  totals: AccountingInvoiceTotals;
}

/**
 * Normalized sales-order shape for the optional `pushSalesOrder`. Re-uses the
 * invoice line/customer shapes — bookkeeping packages model an order as a draft
 * sales document with the same body.
 */
export interface AccountingSalesOrderInput {
  /** Order number as issued by the CRM (orders.order_number). */
  number: string;
  /** Placed/created date, ISO-8601 ('YYYY-MM-DD'). */
  date: string;
  currency: string;
  customer: AccountingInvoiceCustomer;
  lines: AccountingInvoiceLine[];
  totals: AccountingInvoiceTotals;
}

/** Result of a `pushInvoice` / `pushSalesOrder` call. */
export interface AccountingPushResult {
  /** Stable id of the created document at the bookkeeping package. */
  externalId: string;
  /** Raw response body — stored verbatim in accounting_sync_log.raw for audit. */
  raw: Record<string, unknown>;
}

/** Result of `verifyConnection`. */
export interface AccountingVerifyResult {
  ok: boolean;
  detail: string;
}

/** A bookkeeping administration/division as exposed by `listAdministrations`. */
export interface AccountingAdministration {
  id: string;
  name: string;
}

/**
 * Typed "not connected" signal. Adapters throw this from their `requireCreds()`
 * guard so the route-layer can translate it to a clean 409 without leaking which
 * network call would have fired. Mirrors `ChannelNotConnectedError`.
 */
export class AccountingNotConnectedError extends Error {
  readonly error = 'accounting_not_connected' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AccountingNotConnectedError';
  }
}

/** Type-guard for {@link AccountingNotConnectedError} (works across realms). */
export function isAccountingNotConnectedError(
  e: unknown,
): e is AccountingNotConnectedError {
  return (
    e instanceof AccountingNotConnectedError ||
    (typeof e === 'object' &&
      e !== null &&
      (e as { error?: unknown }).error === 'accounting_not_connected')
  );
}

/**
 * Shared adapter contract. Concrete adapters (moneybird/exact/eboekhouden)
 * implement this; the registry resolves a provider string to one of them.
 */
export interface AccountingAdapter {
  /** Provider this adapter handles: 'moneybird' | 'exact' | 'eboekhouden'. */
  readonly provider: string;

  /** Cheap reachability/credentials check. Never throws — returns ok:false. */
  verifyConnection(conn: AccountingConnection): Promise<AccountingVerifyResult>;

  /** Push a single invoice. Guarded behind requireCreds. */
  pushInvoice(
    conn: AccountingConnection,
    invoice: AccountingInvoiceInput,
  ): Promise<AccountingPushResult>;

  /** Optionally push a sales-order (draft sales document). Guarded. */
  pushSalesOrder?(
    conn: AccountingConnection,
    order: AccountingSalesOrderInput,
  ): Promise<AccountingPushResult>;

  /** Optionally list the administrations/divisions the credentials can reach. */
  listAdministrations?(
    conn: AccountingConnection,
  ): Promise<AccountingAdministration[]>;
}
