/**
 * `requireAuth` Hono middleware — leest sessie-cookie + stuurt 401 als
 * geen geldige sessie. Bij success zet `c.set('user', ...)` op context.
 */
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import {
  SESSION_COOKIE_NAME,
  validateSessionToken,
  type AuthUser,
} from '../lib/auth.js';

export type AuthVariables = {
  user: AuthUser;
};

export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  const user = await validateSessionToken(token);
  if (!user) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  c.set('user', user);
  await next();
};
