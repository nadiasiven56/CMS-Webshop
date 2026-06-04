/**
 * Payment-provider factory (Wave-H A4).
 *
 * `getPaymentProvider(shop)` resolves the configured PSP for a shop, or `null`
 * when the shop has no provider / no usable key. The route-layer goes through
 * this factory so it never hard-codes a PSP — and a `null` result is the signal
 * to keep the offline mock-paid checkout path (nothing fires to a PSP).
 *
 * Decryption happens here (via channel-crypto, the SAME scheme channels use):
 * `shops.payment_credentials` is an encrypted `{ enc }` blob holding
 * `{ apiKey: 'test_…' | 'live_…' }`.
 */
import { decryptCredentials } from '../../lib/channel-crypto.js';
import { MollieProvider } from './mollie.js';
import type { PaymentProvider } from './types.js';

/** Minimal shop-shape the factory needs (subset of Shop). */
export interface PaymentConfigurableShop {
  paymentProvider?: string | null;
  paymentCredentials?: { enc: string } | null;
}

/** All provider keys that have a registered implementation. */
export const SUPPORTED_PAYMENT_PROVIDERS = ['mollie'] as const;
export type SupportedPaymentProvider = (typeof SUPPORTED_PAYMENT_PROVIDERS)[number];

/**
 * Resolve the PaymentProvider for a shop, or `null` when not configured.
 *
 * Returns `null` (→ caller keeps mock-paid) when ANY of:
 *   - shop has no `payment_provider`;
 *   - the provider key is not supported;
 *   - credentials are missing / un-decryptable / the apiKey is empty.
 *
 * NEVER throws for the unconfigured case — `null` is the non-breaking signal.
 */
export function getPaymentProvider(
  shop: PaymentConfigurableShop,
): PaymentProvider | null {
  const provider = shop.paymentProvider?.trim();
  if (!provider) return null;

  switch (provider) {
    case 'mollie': {
      const apiKey = decryptApiKey(shop.paymentCredentials ?? null);
      if (!apiKey) return null;
      try {
        return new MollieProvider(apiKey);
      } catch {
        // Constructor only throws when the key is empty — already guarded, but
        // be safe and degrade to the unconfigured path rather than crash checkout.
        return null;
      }
    }
    default:
      return null;
  }
}

/** Decrypt the stored credential blob and pull a non-empty `apiKey`, or null. */
function decryptApiKey(stored: { enc: string } | null): string | null {
  const creds = decryptCredentials(stored);
  if (!creds) return null;
  const key = typeof creds.apiKey === 'string' ? creds.apiKey.trim() : '';
  return key.length > 0 ? key : null;
}

export * from './types.js';
export { MollieProvider, mapMollieStatus } from './mollie.js';
