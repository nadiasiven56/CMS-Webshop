/**
 * SendGridProvider — CONNECT-READY adapter for the SendGrid v3 Mail Send API.
 *
 * Implements the OFFICIAL SendGrid contract (Bearer apiKey, POST
 * https://api.sendgrid.com/v3/mail/send with the personalizations/content JSON
 * body) but is READY UP TO THE KEY-ENTRY POINT: nothing live ever fires without
 * credentials. `send` first calls the private `requireCreds()` guard, which
 * throws a typed {@link EmailProviderNotConnectedError} ('SendGrid credentials
 * required') when the provider is not `status='connected'` or the apiKey empty.
 *
 * Credentials shape (stored encrypted, decrypted in-memory): { apiKey }
 * Config (plain jsonb): { fromEmail, fromName, replyTo, ... }
 *
 * Note: SendGrid returns 202 Accepted with an empty body on success; the
 * provider message id is exposed via the `X-Message-Id` response header.
 */
import type { EmailProviderConfig } from '../../../db/schema/notifications.js';
import { decryptCredentials } from '../../../lib/channel-crypto.js';
import {
  EmailProviderNotConnectedError,
  resolveSender,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
  type EmailVerifyResult,
} from './types.js';

const ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';
const VERSION_NOTE = 'SendGrid v3 Mail Send API';

interface SendGridContext {
  apiKey: string;
}

export class SendGridProvider implements EmailProvider {
  readonly provider = 'sendgrid';

  /**
   * Guard: returns the decrypted apiKey only when the provider is connected and
   * the key is present. Otherwise throws the typed not-connected error so NO
   * live request can fire.
   */
  private requireCreds(config: EmailProviderConfig): SendGridContext {
    if (config.status !== 'connected') {
      throw new EmailProviderNotConnectedError('SendGrid credentials required');
    }
    const creds = decryptCredentials(
      (config.credentials ?? null) as { enc: string } | null,
    );
    const apiKey = creds && typeof creds.apiKey === 'string' ? creds.apiKey : '';
    if (!apiKey) {
      throw new EmailProviderNotConnectedError('SendGrid credentials required');
    }
    return { apiKey };
  }

  async verifyConnection(config: EmailProviderConfig): Promise<EmailVerifyResult> {
    let ctx: SendGridContext;
    try {
      ctx = this.requireCreds(config);
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'SendGrid credentials required',
      };
    }
    try {
      // Cheap proof the key is valid: the scopes endpoint.
      const res = await fetch('https://api.sendgrid.com/v3/scopes', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${ctx.apiKey}`,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, detail: `sendgrid ${res.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true, detail: `${VERSION_NOTE} verbonden` };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'sendgrid connection failed',
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

    const content: Array<{ type: string; value: string }> = [];
    if (message.text) content.push({ type: 'text/plain', value: message.text });
    content.push({ type: 'text/html', value: message.html });

    const body: Record<string, unknown> = {
      personalizations: [{ to: [{ email: message.to }] }],
      from: fromName ? { email: fromAddress, name: fromName } : { email: fromAddress },
      subject: message.subject,
      content,
    };
    if (sender.replyTo) body.reply_to = { email: sender.replyTo };

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`sendgrid ${res.status}: ${text.slice(0, 300)}`);
    }
    // 202 Accepted, empty body — id is in the X-Message-Id header.
    const messageId = res.headers.get('x-message-id') ?? '';
    return {
      providerMessageId: messageId,
      raw: { status: res.status, xMessageId: messageId },
    };
  }
}

export const sendgridProvider = new SendGridProvider();
