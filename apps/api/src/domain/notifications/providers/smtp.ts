/**
 * SmtpProvider — CONNECT-READY *scaffold* for a plain SMTP transport.
 *
 * IMPORTANT: this adapter is intentionally DEPENDENCY-FREE. Implementing a real
 * SMTP client (TLS handshake, AUTH LOGIN/PLAIN, MIME framing, dot-stuffing)
 * without a library like `nodemailer` is out of scope for the koppel-klaar
 * scaffold, and adding an npm dependency is explicitly disallowed. So `send`
 * throws a typed not-connected-style error noting the transport is not yet
 * enabled. The orchestrator can later either:
 *   - add `nodemailer` and implement `send` against `config.smtpHost/...`, or
 *   - route SMTP through one of the HTTP providers (postmark/sendgrid/mailgun).
 *
 * `verifyConnection` does NOT open a real socket — it only confirms the config
 * is present (host + user + pass), returning `detail: 'config present'`.
 *
 * Credentials shape (stored encrypted, decrypted in-memory):
 *   { host, port, user, pass, secure }
 * Config (plain jsonb): { fromEmail, fromName, replyTo, smtpHost/Port/Secure }
 */
import type { EmailProviderConfig } from '../../../db/schema/notifications.js';
import { decryptCredentials } from '../../../lib/channel-crypto.js';
import {
  EmailProviderNotConnectedError,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
  type EmailVerifyResult,
} from './types.js';

interface SmtpCreds {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
}

export class SmtpProvider implements EmailProvider {
  readonly provider = 'smtp';

  /**
   * Guard: returns the decrypted SMTP creds only when host + user + pass are
   * present. (We do NOT gate verifyConnection on `status==='connected'` here —
   * see verifyConnection's docstring — but `send` still requires connected.)
   */
  private resolveCreds(config: EmailProviderConfig): SmtpCreds | null {
    const creds = decryptCredentials(
      (config.credentials ?? null) as { enc: string } | null,
    );
    const host = creds && typeof creds.host === 'string' ? creds.host : '';
    const user = creds && typeof creds.user === 'string' ? creds.user : '';
    const pass = creds && typeof creds.pass === 'string' ? creds.pass : '';
    if (!host || !user || !pass) return null;
    const port =
      creds && typeof creds.port === 'number'
        ? creds.port
        : creds && typeof creds.port === 'string'
          ? Number(creds.port) || 587
          : 587;
    const secure = Boolean(creds?.secure);
    return { host, port, user, pass, secure };
  }

  async verifyConnection(config: EmailProviderConfig): Promise<EmailVerifyResult> {
    // No real socket — only confirm the config is present. This keeps the
    // scaffold dependency-free while still letting the operator see whether the
    // SMTP credentials block has been filled in.
    const creds = this.resolveCreds(config);
    if (!creds) {
      return { ok: false, detail: 'SMTP host/user/pass required' };
    }
    return { ok: true, detail: 'config present' };
  }

  async send(
    config: EmailProviderConfig,
    _message: EmailMessage,
  ): Promise<EmailSendResult> {
    if (config.status !== 'connected') {
      throw new EmailProviderNotConnectedError('SMTP credentials required');
    }
    const creds = this.resolveCreds(config);
    if (!creds) {
      throw new EmailProviderNotConnectedError('SMTP credentials required');
    }
    // TODO(orchestrator): wire a real SMTP transport here (nodemailer) or route
    // SMTP through an HTTP provider. Kept dependency-free for the scaffold, so
    // no live mail can be sent over SMTP yet.
    throw new EmailProviderNotConnectedError('smtp transport not yet enabled');
  }
}

export const smtpProvider = new SmtpProvider();
