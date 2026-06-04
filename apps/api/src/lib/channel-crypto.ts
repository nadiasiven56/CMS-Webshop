/**
 * Channel-credential crypto — AES-256-GCM via node:crypto.
 *
 * Marketplace-channels (bol/amazon/gmc) slaan hun API-keys/tokens encrypted op
 * in `channels.credentials` (jsonb, shape `{ enc: string }`). We versleutelen de
 * hele credential-object als JSON; alleen deze module kent de raw waarden.
 *
 * Sleutel-derivatie: SHA-256 over `env.CHANNEL_SECRET_KEY` levert exact 32 bytes
 * (AES-256-vereiste), ongeacht de lengte van de configuratie-string (die is
 * >=32 chars maar niet noodzakelijk 32 *bytes* na encoding).
 *
 * Opslag-formaat: base64 van `iv:authTag:ciphertext` — drie base64-segmenten
 * gescheiden door ':' (dus elk segment apart base64, niet het geheel). De IV is
 * random per encrypt (12 bytes, GCM-standaard) zodat dezelfde plaintext nooit
 * dezelfde ciphertext geeft.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from './env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM-aanbevolen IV-lengte
const AUTH_TAG_BYTES = 16;

/** 32-byte sleutel afgeleid van de geconfigureerde secret (AES-256). */
const key = createHash('sha256').update(env.CHANNEL_SECRET_KEY).digest();

/**
 * Versleutel een credential-object. Geeft `{ enc }` terug, klaar om als jsonb in
 * `channels.credentials` op te slaan. Het `enc`-veld is `<iv>:<authTag>:<ct>`
 * met elk segment base64-encoded.
 */
export function encryptCredentials(obj: Record<string, unknown>): { enc: string } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const enc = [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
  return { enc };
}

/**
 * Ontsleutel een opgeslagen credential-blob. Geeft `null` als input ontbreekt,
 * leeg is, of een ongeldig/corrupt formaat heeft (i.p.v. te throwen, zodat een
 * caller een kapotte/niet-gezette credential gracieus kan behandelen).
 */
export function decryptCredentials(
  stored: { enc: string } | null | undefined,
): Record<string, unknown> | null {
  if (!stored || typeof stored.enc !== 'string' || stored.enc.length === 0) {
    return null;
  }
  const parts = stored.enc.split(':');
  if (parts.length !== 3) return null;
  const ivB64 = parts[0]!;
  const tagB64 = parts[1]!;
  const ctB64 = parts[2]!;
  try {
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(ctB64, 'base64');
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) return null;
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    // Verkeerde sleutel, gemanipuleerde data (authTag-mismatch), of corrupt
    // base64/JSON → behandel als "niet ontsleutelbaar".
    return null;
  }
}

/**
 * Maak een veilige presence-map: voor elke key in `obj` `'set'` als er een
 * niet-lege waarde staat, anders `null`. NOOIT de echte waarde teruggeven — dit
 * is wat de API mag tonen ("welke credential-velden zijn ingevuld") zonder
 * geheimen te lekken.
 */
export function maskCredentials(
  obj: Record<string, unknown> | null,
): Record<string, 'set' | null> {
  const out: Record<string, 'set' | null> = {};
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    const isSet =
      v !== null &&
      v !== undefined &&
      !(typeof v === 'string' && v.length === 0);
    out[k] = isSet ? 'set' : null;
  }
  return out;
}
