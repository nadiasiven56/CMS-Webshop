/**
 * PostmarkProvider — CONNECT-READY adapter for the Postmark Email API.
 *
 * Implements the OFFICIAL Postmark contract (X-Postmark-Server-Token header,
 * POST https://api.postmarkapp.com/email with a JSON body) but is READY UP TO
 * THE KEY-ENTRY POINT: nothing live ever fires without credentials. `send`
 * first calls the private `requireCreds()` guard, which throws a typed
 * {@link EmailProviderNotConnectedError} ('Postmark credentials required') when
 * the provider is not `status='connected'` or the serverToken is empty.
 *
 * Credentials shape (stored encrypted, decrypted in-memory): { serverToken }
 * Config (plain jsonb): { fromEmail, fromName, replyTo, ... }
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

const ENDPOINT = 'https://api.postmarkapp.com/email';
const VERSION_NOTE = 'Postmark Email API';

interface PostmarkContext {
  serverToken: string;
}

export class PostmarkProvider implements EmailProvider {
  readonly provider = 'postmark';

  /**
   * Guard: returns the decrypted server-token only when the provider is
   * connected and the token is present. Otherwise throws the typed not-connected
   * error so NO live request can fire.
   */
  private requireCreds(config: EmailProviderConfig): PostmarkContext {
    if (config.status !== 'connected') {
      throw new EmailProviderNotConnectedError('Postmark credentials required');
    }
    const creds = decryptCredentials(
      (config.credentials ?? null) as { enc: string } | null,
    );
    const serverToken =
      creds && typeof creds.serverToken === 'string' ? creds.serverToken : '';
    if (!serverToken) {
      throw new EmailProviderNotConnectedError('Postmark credentials required');
    }
    return { serverToken };
  }

  async verifyConnection(config: EmailProviderConfig): Promise<EmailVerifyResult> {
    let ctx: PostmarkContext;
    try {
      ctx = this.requireCreds(config);
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Postmark credentials required',
      };
    }
    try {
      // Cheap proof the token is valid: the server-info endpoint.
      const res = await fetch('https://api.postmarkapp.com/server', {
        headers: {
          Accept: 'application/json',
          'X-Postmark-Server-Token': ctx.serverToken,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, detail: `postmark ${res.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true, detail: `${VERSION_NOTE} verbonden` };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'postmark connection failed',
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

    const body: Record<string, unknown> = {
      From: from,
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      MessageStream: 'outbound',
    };
    if (message.text) body.TextBody = message.text;
    if (sender.replyTo) body.ReplyTo = sender.replyTo;

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': ctx.serverToken,
      },
      body: JSON.stringify(body),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `postmark ${res.status}: ${
          typeof raw.Message === 'string' ? raw.Message : 'send failed'
        }`,
      );
    }
    return { providerMessageId: String(raw.MessageID ?? ''), raw };
  }
}

export const postmarkProvider = new PostmarkProvider();
