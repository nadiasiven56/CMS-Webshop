/**
 * PaymentProvider — uniform contract for every payment-provider integration
 * (Wave-H A4). The checkout/route-layer never talks to a PSP SDK directly; it
 * talks to a `PaymentProvider`. Each concrete provider (mollie / future stripe /
 * adyen) maps the PSP's quirks to the normalized shapes below.
 *
 * Conventions (matching the ChannelAdapter pattern):
 *   - Money stays a decimal STRING. `amountValue` is the gross amount the buyer
 *     pays, formatted EXACTLY as the PSP expects (Mollie: 2-decimal string like
 *     '10.00'); use {@link toAmountValue} to convert a numeric(12,4) money-string.
 *   - NOTHING fires to a PSP without credentials: a provider's constructor
 *     receives only DECRYPTED credentials, and the factory returns `null` when
 *     the shop is not configured/connected — so the caller keeps the offline
 *     mock-paid path. A provider that is constructed but somehow lacks a usable
 *     key MUST throw the typed {@link PaymentNotConnectedError} before any fetch.
 *   - 429 / rate-limit responses are retried with backoff inside the provider;
 *     all PSP errors are normalized to {@link PaymentProviderError}.
 */

/** A PSP payment status normalized across providers. */
export type PaymentStatus =
  | 'open' // created, awaiting buyer action
  | 'pending' // buyer acted, PSP awaiting bank/processor confirmation
  | 'paid' // authoritative success
  | 'authorized' // authorized but not yet captured (card)
  | 'failed'
  | 'expired'
  | 'canceled'
  | 'refunded'
  | 'unknown';

/** Input for {@link PaymentProvider.createPayment}. */
export interface CreatePaymentInput {
  /** Gross amount the buyer pays — STRING formatted per the PSP (2-dec for Mollie). */
  amountValue: string;
  /** ISO-4217 currency (e.g. 'EUR'). */
  currency: string;
  /** Human description shown to the buyer / on the PSP dashboard. */
  description: string;
  /** Our CRM order id — round-tripped via PSP metadata so the webhook can match. */
  orderId: string;
  /** Where the buyer returns after the hosted checkout. */
  redirectUrl: string;
  /** Public webhook the PSP calls with the payment id on status change. */
  webhookUrl: string;
}

/** Result of {@link PaymentProvider.createPayment}. */
export interface CreatePaymentResult {
  /** PSP-side payment id (Mollie: 'tr_xxx'). Store this to match the webhook. */
  providerPaymentId: string;
  /** Hosted-checkout URL the storefront redirects the buyer to. */
  checkoutUrl: string | null;
  /** Initial status (Mollie: 'open'). */
  status: PaymentStatus;
}

/**
 * Typed "not connected" signal. The factory normally returns `null` when a shop
 * has no provider; a provider implementation throws this if it is somehow asked
 * to fire without a usable key, so NO live request can leak out.
 */
export class PaymentNotConnectedError extends Error {
  readonly error = 'channel_not_connected' as const;
  constructor(message: string) {
    super(message);
    this.name = 'PaymentNotConnectedError';
  }
}

/** Type-guard for {@link PaymentNotConnectedError} (works across realms). */
export function isPaymentNotConnectedError(
  e: unknown,
): e is PaymentNotConnectedError {
  return (
    e instanceof PaymentNotConnectedError ||
    (typeof e === 'object' &&
      e !== null &&
      (e as { error?: unknown }).error === 'channel_not_connected')
  );
}

/** Normalized PSP error — carries the upstream HTTP status when known. */
export class PaymentProviderError extends Error {
  readonly error = 'payment_provider_error' as const;
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

/**
 * Shared provider contract. Implementations are constructed with decrypted
 * credentials and never read the DB themselves.
 */
export interface PaymentProvider {
  /** Provider key: 'mollie' (matches shops.payment_provider). */
  readonly provider: string;

  /** Create a hosted payment for an order. */
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /** Fetch the authoritative status of a PSP payment. */
  getStatus(providerPaymentId: string): Promise<PaymentStatus>;

  /**
   * Refund (part of) a payment. `amountValue` is the gross refund formatted per
   * the PSP (2-dec for Mollie); omit for a full refund.
   */
  refund(providerPaymentId: string, amountValue?: string): Promise<PaymentStatus>;
}

/**
 * Convert a numeric(12,4) money-STRING (e.g. '10.0000') to a PSP 2-decimal
 * amount-value (e.g. '10.00'). Uses round-half-away-from-zero on cents and never
 * touches floats beyond the rounding step. Throws on non-finite input so a bad
 * total can never be silently shipped to a PSP.
 */
export function toAmountValue(money: string): string {
  const n = Number(money);
  if (!Number.isFinite(n)) {
    throw new Error(`toAmountValue: invalid money "${money}"`);
  }
  const cents = Math.sign(n) * Math.round(Math.abs(n) * 100);
  return (cents / 100).toFixed(2);
}
