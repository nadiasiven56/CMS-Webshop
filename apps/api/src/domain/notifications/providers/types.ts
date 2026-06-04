/**
 * EmailProvider — uniform contract for every transactional-email integration
 * (smtp / postmark / sendgrid / mailgun).
 *
 * The send-service and the route-layer never talk to a provider HTTP API
 * directly; they talk to an `EmailProvider`. Each concrete adapter maps the
 * provider's quirks to the normalized {@link EmailMessage} shape below.
 *
 * Conventions (mirroring the channels/accounting modules):
 *   - `verifyConnection` is the only cheap, side-effect-free method safe to call
 *     on demand from the UI ("test connection"); it NEVER throws (returns ok:false).
 *   - Every adapter guards `send` behind a private credentials check and surfaces
 *     a typed {@link EmailProviderNotConnectedError} instead of firing a live
 *     request when the provider is not connected or its credentials are empty.
 *   - Credentials live encrypted on `email_provider_config.credentials`; the
 *     adapter decrypts them in-memory inside `requireCreds` and they never leave.
 *   - `config` is the plain jsonb blob on the provider row (fromEmail, fromName,
 *     replyTo, mailgunDomain, smtpHost/smtpPort/smtpSecure, ...).
 */
import type { EmailProviderConfig } from '../../../db/schema/notifications.js';

/** A fully-rendered message handed to {@link EmailProvider.send}. */
export interface EmailMessage {
  /** Recipient address. */
  to: string;
  /** Sender address (resolved from config.fromEmail). */
  from: string;
  /** Sender display name (resolved from config.fromName), optional. */
  fromName?: string | null;
  /** Rendered subject line. */
  subject: string;
  /** Rendered HTML body. */
  html: string;
  /** Rendered plain-text body, optional. */
  text?: string | null;
}

/** Result of `verifyConnection`. Never thrown — always returned. */
export interface EmailVerifyResult {
  ok: boolean;
  detail: string;
}

/** Result of a successful `send`. */
export interface EmailSendResult {
  /** Provider-side message id (for tracing/audit). */
  providerMessageId: string;
  /** Raw response body — stored verbatim in email_log.raw for audit. */
  raw: Record<string, unknown>;
}

/**
 * Typed "not connected" signal. Adapters throw this from their `requireCreds()`
 * guard so the send-service / route-layer can translate it to a clean
 * skipped/failed log row (or a 409) without leaking which network call would
 * have fired. Mirrors `ChannelNotConnectedError` / `AccountingNotConnectedError`.
 */
export class EmailProviderNotConnectedError extends Error {
  readonly error = 'email_provider_not_connected' as const;
  constructor(message: string) {
    super(message);
    this.name = 'EmailProviderNotConnectedError';
  }
}

/** Type-guard for {@link EmailProviderNotConnectedError} (works across realms). */
export function isEmailProviderNotConnectedError(
  e: unknown,
): e is EmailProviderNotConnectedError {
  return (
    e instanceof EmailProviderNotConnectedError ||
    (typeof e === 'object' &&
      e !== null &&
      (e as { error?: unknown }).error === 'email_provider_not_connected')
  );
}

/**
 * Shared adapter contract. Concrete adapters (smtp/postmark/sendgrid/mailgun)
 * implement this; the registry resolves a provider string to one of them.
 */
export interface EmailProvider {
  /** Provider this adapter handles: 'smtp' | 'postmark' | 'sendgrid' | 'mailgun'. */
  readonly provider: string;

  /** Cheap reachability/credentials check. Never throws — returns ok:false. */
  verifyConnection(config: EmailProviderConfig): Promise<EmailVerifyResult>;

  /** Send a fully-rendered message. Guarded behind requireCreds. */
  send(
    config: EmailProviderConfig,
    message: EmailMessage,
  ): Promise<EmailSendResult>;
}

/** Shared shape of the `config` jsonb blob on an email-provider row. */
export interface EmailProviderConfigBlob {
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  mailgunDomain?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
}

/**
 * Resolve the sender block from a provider's config. Returns empty strings when
 * unset so adapters can decide whether to treat a missing fromEmail as an error.
 */
export function resolveSender(config: EmailProviderConfig): {
  fromEmail: string;
  fromName: string;
  replyTo: string;
} {
  const cfg = (config.config ?? {}) as EmailProviderConfigBlob;
  return {
    fromEmail: typeof cfg.fromEmail === 'string' ? cfg.fromEmail : '',
    fromName: typeof cfg.fromName === 'string' ? cfg.fromName : '',
    replyTo: typeof cfg.replyTo === 'string' ? cfg.replyTo : '',
  };
}
