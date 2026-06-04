/**
 * MailgunProvider — CONNECT-READY adapter for the Mailgun Messages API.
 *
 * Implements the OFFICIAL Mailgun contract (HTTP Basic auth `api:{key}`, POST
 * https://api.mailgun.net/v3/{domain}/messages with an
 * application/x-www-form-urlencoded body) but is READY UP TO THE KEY-ENTRY
 * POINT: nothing live ever fires without credentials. `send` first calls the
 * private `requireCreds()` guard, which throws a typed
 * {@link EmailProviderNotConnectedError} ('Mailgun credentials required') when
 * the provider is not `status='connected'`, the apiKey is empty, or the sending
 * domain (config.mailgunDomain) is missing.
 *
 * Credentials shape (stored encrypted, decrypted in-memory): { apiKey }
 * Config (plain jsonb): { mailgunDomain, fromEmail, fromName, replyTo, ... }
 */
import type { EmailProviderConfig } from '../../../db/schema/notifications.js';
import { decryptCredentials } from '../../../lib/channel-crypto.js';
import {
  EmailProviderNotConnectedError,
  resolveSender,
  type EmailMessage,
  type EmailProvider,
  type EmailProviderConfigBlob,
  type EmailSendResult,
  type EmailVerifyResult,
} from './types.js';

const BASE = 'https://api.mailgun.net/v3';
const VERSION_NOTE = 'Mailgun Messages API';

interface MailgunContext {
  apiKey: string;
  domain: string;
}

export class MailgunProvider implements EmailProvider {
  readonly provider = 'mailgun';

  /**
   * Guard: returns the decrypted apiKey + sending domain only when the provider
   * is connected and both are present. Otherwise throws the typed not-connected
   * error so NO live request can fire.
   */
  private requireCreds(config: EmailProviderConfig): MailgunContext {
    if (config.status !== 'connected') {
      throw new EmailProviderNotConnectedError('Mailgun credentials required');
    }
    const creds = decryptCredentials(
      (config.credentials ?? null) as { enc: string } | null,
    );
    const apiKey = creds && typeof creds.apiKey === 'string' ? creds.apiKey : '';
    const cfg = (config.config ?? {}) as EmailProviderConfigBlob;
    const domain = typeof cfg.mailgunDomain === 'string' ? cfg.mailgunDomain : '';
    if (!apiKey || !domain) {
      throw new EmailProviderNotConnectedError('Mailgun credentials required');
    }
    return { apiKey, domain };
  }

  /** Basic-auth header `api:{key}` base64-encoded. */
  private authHeader(apiKey: string): string {
    return `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`;
  }

  async verifyConnection(config: EmailProviderConfig): Promise<EmailVerifyResult> {
    let ctx: MailgunContext;
    try {
      ctx = this.requireCreds(config);
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Mailgun credentials required',
      };
    }
    try {
      // Cheap proof the key + domain are valid: the domain-info endpoint.
      const res = await fetch(`${BASE}/domains/${encodeURIComponent(ctx.domain)}`, {
        headers: {
          Accept: 'application/json',
          Authorization: this.authHeader(ctx.apiKey),
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, detail: `mailgun ${res.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true, detail: `${VERSION_NOTE} verbonden (${ctx.domain})` };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'mailgun connection failed',
      };
    }
  }

  async send(
    config: EmailProviderConfig,
    message: EmailMessage,
  ): Promise<EmailSendResult> {
    const ctx = this.requireCreds(config);
    const sender = resolveSender(config);
    const fromAddress = message.from || sender.fromEmail;
    const fromName = message.fromName ?? sender.fromName;
    const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

    const form = new URLSearchParams();
    form.set('from', from);
    form.set('to', message.to);
    form.set('subject', message.subject);
    form.set('html', message.html);
    if (message.text) form.set('text', message.text);
    if (sender.replyTo) form.set('h:Reply-To', sender.replyTo);

    const res = await fetch(`${BASE}/${encodeURIComponent(ctx.domain)}/messages`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: this.authHeader(ctx.apiKey),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `mailgun ${res.status}: ${
          typeof raw.message === 'string' ? raw.message : 'send failed'
        }`,
      );
    }
    return { providerMessageId: String(raw.id ?? ''), raw };
  }
}

export const mailgunProvider = new MailgunProvider();
