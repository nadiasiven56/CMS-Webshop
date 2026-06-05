/**
 * Auth-laag — sessie-cookies + password-hash.
 *
 * Bewuste keuze: handmatige session-store ipv Lucia-adapter, omdat Lucia v3
 * adapters nog niet allemaal Drizzle-postgres-js stable supporten en deze
 * fix voor V1 simpel is. Wisselen kan later zonder schema-change (tabel
 * `sessions` is Lucia-compatibel).
 */
import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from './db.js';
import { env } from './env.js';
import { sessions } from '../db/schema/sessions.js';
import { users } from '../db/schema/users.js';

// ───────── Password ─────────

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ───────── Session-IDs ─────────

/**
 * Genereer een opaque session-id. Wordt als cookie gezet en als hash in de DB
 * opgeslagen — zo lekt een DB-dump geen bruikbare cookies.
 */
function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ───────── Session-store ─────────

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export interface SessionResult {
  user: AuthUser;
  sessionId: string;
  cookie: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<SessionResult> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(sessions)
    .values({
      id: tokenHash,
      userId,
      expiresAt,
    })
    .returning();

  if (!row) throw new Error('Failed to create session');

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error('User not found after session create');

  return {
    user: { id: user.id, email: user.email, role: user.role },
    sessionId: tokenHash,
    cookie: token,
    expiresAt,
  };
}

export async function validateSessionToken(token: string): Promise<AuthUser | null> {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);

  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, tokenHash))
    .limit(1);

  if (!row) return null;

  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, tokenHash));
    return null;
  }

  return { id: row.userId, email: row.email, role: row.role };
}

export async function invalidateSession(token: string): Promise<void> {
  if (!token) return;
  const tokenHash = hashSessionToken(token);
  await db.delete(sessions).where(eq(sessions.id, tokenHash));
}

// ───────── Cookie helpers ─────────

export const SESSION_COOKIE_NAME = 'webshop_crm_session';

/**
 * Bepaal of de sessie-cookie `Secure` moet zijn — ONTKOPPELD van NODE_ENV.
 *
 * Historisch werd `Secure` puur uit `NODE_ENV==='production'` afgeleid, wat de
 * gedocumenteerde HTTP-only deploy-variant (Caddy op :80) brak: browsers
 * weigeren een `Secure`-cookie over plain HTTP, dus de login lukte niet.
 *
 * Nieuwe regel:
 *   1. `COOKIE_SECURE` expliciet gezet  → die waarde wint (true/false).
 *   2. Anders afgeleid: alleen `Secure` als we in productie draaien ÉN de
 *      publieke URL https is (API_PUBLIC_URL of, als fallback, PUBLIC_BASE_URL).
 *
 * Achter een TLS-terminerende proxy (Cloudflare-tunnel) waar Caddy intern op
 * :80 draait maar de gebruiker extern https krijgt: zet `COOKIE_SECURE=true`.
 */
export function isCookieSecure(): boolean {
  if (env.COOKIE_SECURE !== undefined) return env.COOKIE_SECURE;
  if (env.NODE_ENV !== 'production') return false;
  const publicUrl = env.API_PUBLIC_URL || env.PUBLIC_BASE_URL || '';
  return publicUrl.startsWith('https');
}

export function buildSessionCookie(token: string, expiresAt: Date): string {
  const maxAgeSec = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = isCookieSecure();
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${maxAgeSec}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function buildClearedSessionCookie(): string {
  const secure = isCookieSecure();
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    'Max-Age=0',
  ]
    .filter(Boolean)
    .join('; ');
}

export function readSessionCookie(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}
