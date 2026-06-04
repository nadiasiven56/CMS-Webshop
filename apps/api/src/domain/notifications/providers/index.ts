/**
 * Email-provider registry — resolves a provider string to its concrete
 * {@link EmailProvider}.
 *
 * Supported providers:
 *   - smtp      → dependency-free SMTP scaffold (verify-only; send TODO).
 *   - postmark  → Postmark Email API (X-Postmark-Server-Token).
 *   - sendgrid  → SendGrid v3 Mail Send API (Bearer apiKey).
 *   - mailgun   → Mailgun Messages API (Basic api:{key} + domain).
 *
 * The send-service and the route-layer always go through `getEmailProvider()`
 * so they never hard-code a specific provider HTTP API.
 */
import { smtpProvider } from './smtp.js';
import { postmarkProvider } from './postmark.js';
import { sendgridProvider } from './sendgrid.js';
import { mailgunProvider } from './mailgun.js';
import type { EmailProvider } from './types.js';

const REGISTRY: Record<string, EmailProvider> = {
  smtp: smtpProvider,
  postmark: postmarkProvider,
  sendgrid: sendgridProvider,
  mailgun: mailgunProvider,
};

/** All providers that have a registered adapter. */
export const SUPPORTED_EMAIL_PROVIDERS = Object.keys(
  REGISTRY,
) as ReadonlyArray<string>;

/**
 * Resolve the adapter for a provider string. Returns `null` for an unknown
 * provider so the caller can answer a clean 400/422 instead of throwing.
 */
export function getEmailProvider(provider: string): EmailProvider | null {
  return REGISTRY[provider] ?? null;
}

export { smtpProvider, postmarkProvider, sendgridProvider, mailgunProvider };
export * from './types.js';
