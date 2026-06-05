/**
 * Auth-sessie E2E — tegen de ECHTE Postgres (:7432).
 *
 *   - createSession → validateSessionToken geeft de user terug.
 *   - Een sessie waarvan expiresAt in het verleden ligt: validateSessionToken
 *     geeft null EN verwijdert de DB-rij (lazy cleanup).
 *   - invalidateSession maakt de token ongeldig.
 *   - requireAuth-middleware: 401 zonder/met-ongeldige cookie, doorgang + user
 *     op context bij een geldige cookie.
 *
 * Uniek per run (eigen test-user) + cleanup in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../../lib/db.js';
import { users } from '../../db/schema/users.js';
import { sessions } from '../../db/schema/sessions.js';
import {
  createSession,
  validateSessionToken,
  invalidateSession,
  hashPassword,
  buildSessionCookie,
  SESSION_COOKIE_NAME,
} from '../auth.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';

const RUN = Date.now().toString(36);
const EMAIL = `auth-${RUN}@example.com`;

let userId: string;

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: EMAIL,
      passwordHash: await hashPassword('hunter2-secure'),
      role: 'admin',
    })
    .returning();
  userId = user!.id;
});

afterAll(async () => {
  try {
    // sessions cascaden op user-delete, maar ruim expliciet op.
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  } finally {
    await closeDb();
  }
});

describe('createSession + validateSessionToken', () => {
  it('createSession → validateSessionToken geeft de user terug', async () => {
    const session = await createSession(userId);
    expect(session.cookie).toBeTruthy();
    expect(session.user.email).toBe(EMAIL);

    const user = await validateSessionToken(session.cookie);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(userId);
    expect(user!.email).toBe(EMAIL);
    expect(user!.role).toBe('admin');

    // cleanup
    await invalidateSession(session.cookie);
  });

  it('een ongeldige/onbekende token geeft null', async () => {
    expect(await validateSessionToken('niet-een-echte-token')).toBeNull();
    expect(await validateSessionToken('')).toBeNull();
  });
});

describe('verlopen sessie', () => {
  it('validateSessionToken geeft null EN verwijdert de rij bij expiresAt in het verleden', async () => {
    const session = await createSession(userId);
    // Forceer de sessie-rij naar verlopen.
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.id, session.sessionId));

    const user = await validateSessionToken(session.cookie);
    expect(user).toBeNull();

    // De rij is door validateSessionToken opgeruimd (lazy cleanup).
    const rows = await db.select().from(sessions).where(eq(sessions.id, session.sessionId));
    expect(rows).toHaveLength(0);
  });
});

describe('invalidateSession', () => {
  it('maakt de token ongeldig', async () => {
    const session = await createSession(userId);
    expect(await validateSessionToken(session.cookie)).not.toBeNull();

    await invalidateSession(session.cookie);

    expect(await validateSessionToken(session.cookie)).toBeNull();
    const rows = await db.select().from(sessions).where(eq(sessions.id, session.sessionId));
    expect(rows).toHaveLength(0);
  });
});

describe('requireAuth middleware', () => {
  function app() {
    const a = new Hono<{ Variables: AuthVariables }>();
    a.use('/protected', requireAuth);
    a.get('/protected', (c) => c.json({ ok: true, email: c.get('user').email }));
    return a;
  }

  it('401 zonder cookie', async () => {
    const res = await app().request('/protected');
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error).toBe('unauthenticated');
  });

  it('401 bij een ongeldige cookie', async () => {
    const res = await app().request('/protected', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=garbage-token` },
    });
    expect(res.status).toBe(401);
  });

  it('200 + user op context bij een geldige cookie', async () => {
    const session = await createSession(userId);
    const cookie = buildSessionCookie(session.cookie, session.expiresAt);
    // buildSessionCookie geeft een Set-Cookie-string; voor de request-header
    // sturen we alleen het name=value-deel mee.
    const cookiePair = cookie.split(';')[0]!;
    const res = await app().request('/protected', { headers: { cookie: cookiePair } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.email).toBe(EMAIL);

    await invalidateSession(session.cookie);
  });
});
