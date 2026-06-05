/**
 * Idempotency-middleware E2E — tegen de ECHTE Postgres (:7432).
 *
 * Legt het HUIDIGE gedrag vast:
 *   - Zelfde Idempotency-Key + endpoint: de handler draait maar 1x; de 2e call
 *     krijgt de GECACHTE 2xx-body terug (zonder de handler opnieuw te draaien).
 *   - Een niet-2xx response (bv. 400/500) wordt NIET gecached: de key wordt
 *     vrijgegeven en een volgende call met dezelfde key draait de handler opnieuw.
 *   - Zonder Idempotency-Key draait de handler gewoon elke keer.
 *   - GET (geen write-method) wordt nooit geguard.
 *
 * Unieke key per run + cleanup in afterAll.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { inArray } from 'drizzle-orm';
import { db, closeDb } from '../../lib/db.js';
import { idempotencyKeys } from '../../db/schema/idempotency-keys.js';
import { idempotency } from '../idempotency.js';

const RUN = Date.now().toString(36);
const usedKeys = new Set<string>();
const keyFor = (suffix: string) => {
  const k = `idem-${RUN}-${suffix}`;
  usedKeys.add(k);
  return k;
};

/** Bouw een app met een teller-handler die per pad zijn aantal-calls bijhoudt. */
function makeApp() {
  const calls = { ok: 0, bad: 0, boom: 0 };
  const a = new Hono();
  a.use('*', idempotency);

  a.post('/ok', (c) => {
    calls.ok += 1;
    return c.json({ ok: true, n: calls.ok }, 201);
  });
  a.post('/bad', (c) => {
    calls.bad += 1;
    return c.json({ error: 'nope', n: calls.bad }, 400);
  });
  a.post('/boom', (c) => {
    calls.boom += 1;
    return c.json({ error: 'server', n: calls.boom }, 500);
  });
  a.get('/ok', (c) => {
    calls.ok += 1;
    return c.json({ ok: true, n: calls.ok }, 200);
  });

  return { a, calls };
}

function postWithKey(a: Hono, path: string, key?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers['idempotency-key'] = key;
  return a.request(path, { method: 'POST', headers, body: JSON.stringify({}) });
}

beforeEach(async () => {
  // Begin elke test met een schone lei voor de keys uit deze run.
  if (usedKeys.size) {
    await db.delete(idempotencyKeys).where(inArray(idempotencyKeys.key, [...usedKeys]));
  }
});

afterAll(async () => {
  try {
    if (usedKeys.size) {
      await db.delete(idempotencyKeys).where(inArray(idempotencyKeys.key, [...usedKeys]));
    }
  } finally {
    await closeDb();
  }
});

describe('idempotency middleware', () => {
  it('zelfde key+endpoint: handler draait 1x, 2e call krijgt de gecachte 2xx-body', async () => {
    const { a, calls } = makeApp();
    const key = keyFor('cache-hit');

    const r1 = await postWithKey(a, '/ok', key);
    expect(r1.status).toBe(201);
    const b1 = (await r1.json()) as any;
    expect(b1).toEqual({ ok: true, n: 1 });

    const r2 = await postWithKey(a, '/ok', key);
    expect(r2.status).toBe(201);
    const b2 = (await r2.json()) as any;
    // Identieke (gecachte) body — NIET n:2 → handler is niet opnieuw gedraaid.
    expect(b2).toEqual({ ok: true, n: 1 });

    expect(calls.ok).toBe(1);
  });

  it('een 400 wordt NIET gecached: volgende call met dezelfde key draait opnieuw', async () => {
    const { a, calls } = makeApp();
    const key = keyFor('non2xx-400');

    const r1 = await postWithKey(a, '/bad', key);
    expect(r1.status).toBe(400);
    expect(((await r1.json()) as any).n).toBe(1);

    const r2 = await postWithKey(a, '/bad', key);
    expect(r2.status).toBe(400);
    // n:2 bewijst dat de handler opnieuw draaide (geen cache van de 400).
    expect(((await r2.json()) as any).n).toBe(2);

    expect(calls.bad).toBe(2);

    // De key is na de niet-2xx weer vrij (geen blokkerende rij).
    const rows = await db.select().from(idempotencyKeys).where(inArray(idempotencyKeys.key, [key]));
    expect(rows).toHaveLength(0);
  });

  it('een 500 wordt NIET gecached en geeft de key vrij', async () => {
    const { a, calls } = makeApp();
    const key = keyFor('non2xx-500');

    const r1 = await postWithKey(a, '/boom', key);
    expect(r1.status).toBe(500);
    const r2 = await postWithKey(a, '/boom', key);
    expect(r2.status).toBe(500);
    expect(((await r2.json()) as any).n).toBe(2);
    expect(calls.boom).toBe(2);
  });

  it('zonder Idempotency-Key draait de handler elke keer', async () => {
    const { a, calls } = makeApp();

    const r1 = await postWithKey(a, '/ok');
    const r2 = await postWithKey(a, '/ok');
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(((await r1.json()) as any).n).toBe(1);
    expect(((await r2.json()) as any).n).toBe(2);
    expect(calls.ok).toBe(2);
  });

  it('GET wordt niet geguard (geen write-method)', async () => {
    const { a } = makeApp();
    const key = keyFor('get-not-guarded');
    const res = await a.request('/ok', {
      method: 'GET',
      headers: { 'idempotency-key': key },
    });
    expect(res.status).toBe(200);
    // Geen idempotency-rij geschreven voor een GET.
    const rows = await db.select().from(idempotencyKeys).where(inArray(idempotencyKeys.key, [key]));
    expect(rows).toHaveLength(0);
  });
});
