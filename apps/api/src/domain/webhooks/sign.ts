/**
 * HMAC-signing voor outbound webhooks.
 *
 * De webhook-`secret` is plain text in de DB (per bestaand schema) en wordt hier
 * gebruikt als HMAC-SHA256-key over de exacte request-body. De ontvanger kan met
 * dezelfde secret de signature herberekenen en zo de payload-integriteit +
 * authenticiteit verifieren. Dependency-free — alleen `node:crypto`.
 *
 * Header-formaat: `X-Webshop-Signature: sha256=<hex>` (GitHub-stijl prefix),
 * zodat we later van algoritme kunnen wisselen zonder de header te breken.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header waaronder de signature meegestuurd wordt. */
export const SIGNATURE_HEADER = 'X-Webshop-Signature';

/** Header waaronder het event-type meegestuurd wordt. */
export const EVENT_HEADER = 'X-Webshop-Event';

const PREFIX = 'sha256=';

/**
 * Bereken de HMAC-SHA256 van `body` met `secret` en geef de geprefixte
 * signature-string terug (`sha256=<hex>`).
 */
export function signPayload(secret: string, body: string): string {
  const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `${PREFIX}${hex}`;
}

/**
 * Verifieer een ontvangen signature tegen `secret` + `body`. Vergelijkt in
 * constante tijd. Accepteert zowel `sha256=<hex>` als een kale `<hex>`.
 * Geeft `false` bij elke vorm-mismatch i.p.v. te throwen (test-/lib-helper).
 */
export function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = signPayload(secret, body);
  const provided = signature.startsWith(PREFIX) ? signature : `${PREFIX}${signature}`;

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
