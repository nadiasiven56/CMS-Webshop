/**
 * Public transactional-email service — `sendNotification(...)`.
 *
 * This is the ONE function other domains (orders, returns, ...) call to send a
 * transactional email. It lives under `domain/` (not `routes/`) precisely so
 * those modules can import it WITHOUT a route dependency:
 *
 *   import { sendNotification } from '../notifications/send.js';
 *   await sendNotification({
 *     templateKey: 'order_confirmation',
 *     to: order.email,
 *     data: { customerName, orderNumber, total },
 *     orderId: order.id,
 *   });
 *
 * KOPPEL-KLAAR / NEVER-THROW CONTRACT:
 *   - This function NEVER throws to its caller. Callers (orders/returns) must
 *     never break because email isn't configured yet. Every path writes exactly
 *     one `email_log` row and returns `{ status, logId }`.
 *   - If there is no active, connected provider → log `skipped_no_provider` and
 *     return (no send attempted). This is the key connect-ready behavior.
 *   - If the template is missing/disabled → log `skipped_no_provider` style
 *     (`failed` with a clear error) and return.
 *   - On a live send: success → `sent`; provider error → `failed` (with error).
 *
 * The real provider call is guarded inside each adapter's `requireCreds()`, so
 * nothing live fires until the operator enters a key and activates a provider.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import {
  emailProviderConfig,
  emailTemplates,
  emailLog,
  type EmailProviderConfig,
  type EmailTemplate,
} from '../../db/schema/notifications.js';
import {
  getEmailProvider,
  isEmailProviderNotConnectedError,
  resolveSender,
} from './providers/index.js';

export interface SendNotificationOptions {
  /** Template key, e.g. 'order_confirmation' | 'order_shipped' | ... */
  templateKey: string;
  /** Recipient email address. */
  to: string;
  /** Template variables, substituted via {@link renderTemplate}. */
  data: Record<string, unknown>;
  /** Optional CRM order id to correlate the log row with. */
  orderId?: string;
}

export interface SendNotificationResult {
  /** 'sent' | 'failed' | 'skipped_no_provider' */
  status: string;
  /** Id of the written email_log row. */
  logId: string;
}

/**
 * Tiny mustache-style `{{var}}` replacer — pure, dependency-free.
 *
 * Replaces every `{{ key }}` occurrence with `String(data[key])`. Unknown keys
 * are replaced with an empty string (so half-filled data never leaks a literal
 * `{{var}}` into a customer email). Whitespace inside the braces is tolerated.
 * Values are stringified as-is (no HTML-escaping — templates are operator-owned
 * trusted content, and the variables are CRM-internal like order numbers).
 */
export function renderTemplate(
  str: string,
  data: Record<string, unknown>,
): string {
  if (!str) return '';
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = data[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

/** Load the single active, connected provider (if any). */
async function loadActiveProvider(): Promise<EmailProviderConfig | null> {
  const [row] = await db
    .select()
    .from(emailProviderConfig)
    .where(
      and(
        eq(emailProviderConfig.isActive, true),
        eq(emailProviderConfig.status, 'connected'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Load an enabled template by key. */
async function loadTemplate(key: string): Promise<EmailTemplate | null> {
  const [row] = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.key, key), eq(emailTemplates.enabled, true)))
    .limit(1);
  return row ?? null;
}

/** Append one email_log row and return its id. Never throws on the happy path. */
async function writeLog(entry: {
  templateKey: string | null;
  toEmail: string;
  subject: string;
  status: string;
  provider: string | null;
  error: string | null;
  orderId: string | null;
  raw: Record<string, unknown> | null;
}): Promise<string> {
  const [row] = await db
    .insert(emailLog)
    .values({
      templateKey: entry.templateKey,
      toEmail: entry.toEmail,
      subject: entry.subject,
      status: entry.status,
      provider: entry.provider,
      error: entry.error,
      orderId: entry.orderId,
      raw: entry.raw,
    })
    .returning({ id: emailLog.id });
  return row?.id ?? '';
}

/**
 * Send a transactional email. NEVER throws — always logs + returns a status.
 * See the module docstring for the full connect-ready contract.
 */
export async function sendNotification(
  opts: SendNotificationOptions,
): Promise<SendNotificationResult> {
  const orderId = opts.orderId ?? null;

  // 1) No active+connected provider → skip (connect-ready behavior).
  const providerConfig = await loadActiveProvider();
  if (!providerConfig) {
    const logId = await writeLog({
      templateKey: opts.templateKey,
      toEmail: opts.to,
      subject: '',
      status: 'skipped_no_provider',
      provider: null,
      error: 'no active connected email provider',
      orderId,
      raw: null,
    });
    logger.info(
      { templateKey: opts.templateKey, to: opts.to },
      'sendNotification skipped — no active provider',
    );
    return { status: 'skipped_no_provider', logId };
  }

  // 2) Resolve template. Missing/disabled → log failed (clear error), no throw.
  const template = await loadTemplate(opts.templateKey);
  if (!template) {
    const logId = await writeLog({
      templateKey: opts.templateKey,
      toEmail: opts.to,
      subject: '',
      status: 'failed',
      provider: providerConfig.provider,
      error: `template '${opts.templateKey}' not found or disabled`,
      orderId,
      raw: null,
    });
    logger.warn(
      { templateKey: opts.templateKey, to: opts.to },
      'sendNotification failed — template missing/disabled',
    );
    return { status: 'failed', logId };
  }

  // 3) Render subject/html/text with the tiny {{var}} replacer.
  const subject = renderTemplate(template.subject, opts.data);
  const html = renderTemplate(template.bodyHtml, opts.data);
  const text = template.bodyText ? renderTemplate(template.bodyText, opts.data) : null;
  const sender = resolveSender(providerConfig);

  // 4) Resolve adapter + send, guarded. Unknown provider → failed, no throw.
  const adapter = getEmailProvider(providerConfig.provider);
  if (!adapter) {
    const logId = await writeLog({
      templateKey: opts.templateKey,
      toEmail: opts.to,
      subject,
      status: 'failed',
      provider: providerConfig.provider,
      error: `unsupported email provider '${providerConfig.provider}'`,
      orderId,
      raw: null,
    });
    return { status: 'failed', logId };
  }

  try {
    const result = await adapter.send(providerConfig, {
      to: opts.to,
      from: sender.fromEmail,
      fromName: sender.fromName || null,
      subject,
      html,
      text,
    });
    const logId = await writeLog({
      templateKey: opts.templateKey,
      toEmail: opts.to,
      subject,
      status: 'sent',
      provider: providerConfig.provider,
      error: null,
      orderId,
      raw: { providerMessageId: result.providerMessageId, ...result.raw },
    });
    logger.info(
      { templateKey: opts.templateKey, to: opts.to, provider: providerConfig.provider },
      'sendNotification sent',
    );
    return { status: 'sent', logId };
  } catch (err) {
    // requireCreds guard fired, or the provider rejected the send. Either way:
    // log + return, NEVER throw to the caller.
    const skipped = isEmailProviderNotConnectedError(err);
    const status = skipped ? 'skipped_no_provider' : 'failed';
    const message = err instanceof Error ? err.message : 'send failed';
    const logId = await writeLog({
      templateKey: opts.templateKey,
      toEmail: opts.to,
      subject,
      status,
      provider: providerConfig.provider,
      error: message,
      orderId,
      raw: null,
    });
    logger.warn(
      { templateKey: opts.templateKey, to: opts.to, provider: providerConfig.provider, err: message },
      `sendNotification ${status}`,
    );
    return { status, logId };
  }
}
