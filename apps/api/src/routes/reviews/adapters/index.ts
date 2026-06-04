/**
 * Review-adapter registry — resolves a review-provider string to its concrete
 * {@link ReviewAdapter}.
 *
 * Supported providers:
 *   - kiyoh      → CONNECT-READY Kiyoh review API adapter (apiHash + locationId).
 *   - trustpilot → CONNECT-READY Trustpilot adapter (OAuth Bearer + businessUnitId).
 *   - google     → CONNECT-READY Google Business Profile adapter (read-only; no
 *                  invitation API).
 *
 * The route-layer + domain service always go through `getReviewAdapter()` so
 * they never hard-code a specific provider API.
 */
import { kiyohAdapter } from './kiyoh.js';
import { trustpilotAdapter } from './trustpilot.js';
import { googleAdapter } from './google.js';
import {
  ReviewSourceNotConnectedError,
  isReviewSourceNotConnectedError,
  type ReviewAdapter,
} from './types.js';

const REGISTRY: Record<string, ReviewAdapter> = {
  kiyoh: kiyohAdapter,
  trustpilot: trustpilotAdapter,
  google: googleAdapter,
};

/** All review-providers that have a registered adapter. */
export const SUPPORTED_REVIEW_PROVIDERS = Object.keys(
  REGISTRY,
) as ReadonlyArray<string>;

/**
 * Resolve the adapter for a provider string. Returns `null` for an unknown
 * provider so the caller can answer a clean 400/422 instead of throwing.
 */
export function getReviewAdapter(provider: string): ReviewAdapter | null {
  return REGISTRY[provider] ?? null;
}

export { kiyohAdapter, trustpilotAdapter, googleAdapter };
export { ReviewSourceNotConnectedError, isReviewSourceNotConnectedError };
