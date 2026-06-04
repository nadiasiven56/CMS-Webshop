/**
 * Accounting-adapter registry — resolves a provider string to its concrete
 * {@link AccountingAdapter}.
 *
 * Supported providers (all CONNECT-READY, guarded behind requireCreds):
 *   - moneybird    → Moneybird API v2 (Bearer OAuth token).
 *   - exact        → Exact Online REST API v1 (Bearer OAuth2 token).
 *   - eboekhouden  → e-Boekhouden (session-token via username + 2 codes).
 *
 * The route-layer always goes through `getAccountingAdapter()` so it never
 * hard-codes a specific bookkeeping SDK.
 */
import { moneybirdAdapter } from './moneybird.js';
import { exactAdapter } from './exact.js';
import { eboekhoudenAdapter } from './eboekhouden.js';
import type { AccountingAdapter } from './types.js';

const REGISTRY: Record<string, AccountingAdapter> = {
  moneybird: moneybirdAdapter,
  exact: exactAdapter,
  eboekhouden: eboekhoudenAdapter,
};

/** All providers that have a registered adapter. */
export const SUPPORTED_ACCOUNTING_PROVIDERS = Object.keys(
  REGISTRY,
) as ReadonlyArray<string>;

/**
 * Resolve the adapter for a provider string. Returns `null` for an unknown
 * provider so the caller can answer a clean 400/422 instead of throwing.
 */
export function getAccountingAdapter(provider: string): AccountingAdapter | null {
  return REGISTRY[provider] ?? null;
}

export { moneybirdAdapter, exactAdapter, eboekhoudenAdapter };
