/**
 * Sanity tests voor auth.ts — geen DB-mock, alleen helpers.
 * Volledige session-flow tests komen in feature-agent rondes (echte DB).
 */
import { describe, it, expect } from 'vitest';
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  hashPassword,
  readSessionCookie,
  verifyPassword,
  SESSION_COOKIE_NAME,
} from './auth.js';

describe('password hashing', () => {
  it('hashes and verifies correctly', async () => {
    const hash = await hashPassword('hunter2-secure');
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword('hunter2-secure', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('cookie helpers', () => {
  it('builds session cookie with HttpOnly + SameSite=Lax', () => {
    const futureDate = new Date(Date.now() + 60_000);
    const cookie = buildSessionCookie('abc', futureDate);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=abc`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('builds cleared cookie with Max-Age=0', () => {
    const cookie = buildClearedSessionCookie();
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
  });

  it('reads cookie value from header', () => {
    const header = `other=foo; ${SESSION_COOKIE_NAME}=token123; bar=baz`;
    expect(readSessionCookie(header)).toBe('token123');
    expect(readSessionCookie(undefined)).toBeNull();
    expect(readSessionCookie(null)).toBeNull();
    expect(readSessionCookie('nope=1')).toBeNull();
  });
});
