import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { users } from '../db/schema/users.js';
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSession,
  hashPassword,
  invalidateSession,
  SESSION_COOKIE_NAME,
  verifyPassword,
} from '../lib/auth.js';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'minimaal 8 tekens'),
});

export const authRoutes = new Hono<{ Variables: AuthVariables }>();

/**
 * POST /api/auth/register — multi-user: iedereen kan een account aanmaken.
 *   body: { email, password (min 8) }
 *   201: { user: { id, email, role: 'user' } }  + sessie-cookie (auto-login)
 *   409: { error: 'email_taken' }
 *
 * Nieuwe accounts krijgen role 'user' (tenant): zien alleen eigen shops/
 * producten. De operator blijft de enige 'admin'.
 */
authRoutes.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }

  const email = parsed.data.email.toLowerCase().trim();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    return c.json({ error: 'email_taken' }, 409);
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, role: 'user' })
    .returning();
  if (!user) {
    return c.json({ error: 'internal_error' }, 500);
  }

  const session = await createSession(user.id);
  c.header('Set-Cookie', buildSessionCookie(session.cookie, session.expiresAt));

  logger.info({ userId: user.id }, 'register success');
  return c.json({ user: session.user }, 201);
});

/**
 * POST /api/auth/login
 *   body: { email, password }
 *   200: { user: { id, email, role } }
 *   401: { error: 'invalid_credentials' }
 */
authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }

  const { email, password } = parsed.data;
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) {
    // dummy hash-verify om timing-attacks te ontmoedigen
    await verifyPassword(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    return c.json({ error: 'invalid_credentials' }, 401);
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return c.json({ error: 'invalid_credentials' }, 401);
  }

  const session = await createSession(user.id);
  // Cookie raw token (NIET de hash) gaat naar de browser.
  c.header('Set-Cookie', buildSessionCookie(session.cookie, session.expiresAt));

  logger.info({ userId: user.id }, 'login success');
  return c.json({ user: session.user });
});

/**
 * POST /api/auth/logout
 *   200: { ok: true }
 *
 * Idempotent: ook zonder geldige sessie geeft 200.
 */
authRoutes.post('/logout', async (c) => {
  // Lees raw cookie hier rechtstreeks (geen requireAuth nodig).
  const cookieHeader = c.req.header('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  const token = match?.[1];
  if (token) {
    try {
      await invalidateSession(token);
    } catch (err) {
      logger.warn({ err }, 'logout: session-invalidate failed (non-fatal)');
    }
  }
  c.header('Set-Cookie', buildClearedSessionCookie());
  return c.json({ ok: true });
});

/**
 * GET /api/auth/me
 *   200: { user: { id, email, role } }
 *   401: { error: 'unauthenticated' }
 */
authRoutes.get('/me', requireAuth, async (c) => {
  const user = c.get('user');
  return c.json({ user });
});

// `setCookie` import was added preemptively but not used — silence linters.
void setCookie;
