/**
 * Pure unit-tests voor de outbound-webhook helpers — GEEN echte fetch / DB.
 *
 *  - `signPayload` is deterministisch (zelfde secret+body → zelfde sig) en
 *    geprefixt met `sha256=`.
 *  - `verifySignature` accepteert zowel `sha256=<hex>` als kale `<hex>`, en geeft
 *    `false` bij 1 byte verschil, lege body (andere body) of een ander secret.
 *  - `webhookMatchesEvent` honoreert exact-event, category-wildcards en de grove
 *    scope-categorie (all / star / leeg vs een specifieke categorie).
 */
import { describe, it, expect } from 'vitest';
import { signPayload, verifySignature } from '../sign.js';
import { webhookMatchesEvent } from '../dispatch.js';

const SECRET = 'whsec_test_0123456789abcdef';
const BODY = JSON.stringify({ event: 'order.created', occurredAt: '2026-06-05T10:00:00.000Z', data: { id: 'o1' } });

describe('signPayload', () => {
  it('is deterministisch en geprefixt met sha256=', () => {
    const a = signPayload(SECRET, BODY);
    const b = signPayload(SECRET, BODY);
    expect(a).toBe(b);
    expect(a.startsWith('sha256=')).toBe(true);
    // hex-digest na de prefix is 64 tekens (sha256).
    expect(a.slice('sha256='.length)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verschilt bij een ander secret of een andere body', () => {
    expect(signPayload(SECRET, BODY)).not.toBe(signPayload('ander-secret', BODY));
    expect(signPayload(SECRET, BODY)).not.toBe(signPayload(SECRET, `${BODY} `));
  });
});

describe('verifySignature', () => {
  it('true op de correcte signature (met sha256=-prefix)', () => {
    const sig = signPayload(SECRET, BODY);
    expect(verifySignature(SECRET, BODY, sig)).toBe(true);
  });

  it('true op de correcte signature zonder prefix (kale hex)', () => {
    const sig = signPayload(SECRET, BODY);
    const bareHex = sig.slice('sha256='.length);
    expect(verifySignature(SECRET, BODY, bareHex)).toBe(true);
  });

  it('false bij 1 byte verschil in de body', () => {
    const sig = signPayload(SECRET, BODY);
    expect(verifySignature(SECRET, `${BODY}X`, sig)).toBe(false);
  });

  it('false bij een lege body (sig hoort bij een niet-lege body)', () => {
    const sig = signPayload(SECRET, BODY);
    expect(verifySignature(SECRET, '', sig)).toBe(false);
  });

  it('false bij een ander secret', () => {
    const sig = signPayload(SECRET, BODY);
    expect(verifySignature('verkeerd-secret', BODY, sig)).toBe(false);
  });

  it('false bij een 1-byte-gemuteerde signature (zelfde lengte)', () => {
    const sig = signPayload(SECRET, BODY);
    // Flip het laatste hex-teken zonder de lengte te wijzigen.
    const last = sig.slice(-1);
    const flipped = last === 'a' ? 'b' : 'a';
    const mutated = sig.slice(0, -1) + flipped;
    expect(verifySignature(SECRET, BODY, mutated)).toBe(false);
  });
});

describe('webhookMatchesEvent', () => {
  it('matcht een exact event (scope leeg)', () => {
    expect(webhookMatchesEvent({ event: 'order.created', scope: '' }, 'order.created')).toBe(true);
  });

  it('matcht NIET een ander exact event', () => {
    expect(webhookMatchesEvent({ event: 'order.created', scope: '' }, 'order.paid')).toBe(false);
  });

  it("'order.*'-wildcard matcht order.created", () => {
    expect(webhookMatchesEvent({ event: 'order.*', scope: '' }, 'order.created')).toBe(true);
    expect(webhookMatchesEvent({ event: 'order.*', scope: '' }, 'order.paid')).toBe(true);
  });

  it("'order.*'-wildcard matcht NIET product.created", () => {
    expect(webhookMatchesEvent({ event: 'order.*', scope: '' }, 'product.created')).toBe(false);
  });

  it("'*'-wildcard matcht elk event", () => {
    expect(webhookMatchesEvent({ event: '*', scope: '' }, 'product.created')).toBe(true);
    expect(webhookMatchesEvent({ event: '*', scope: '' }, 'stock.low')).toBe(true);
  });

  it('scope all/*/leeg laat een matchend event door', () => {
    expect(webhookMatchesEvent({ event: 'order.created', scope: 'all' }, 'order.created')).toBe(true);
    expect(webhookMatchesEvent({ event: 'order.created', scope: '*' }, 'order.created')).toBe(true);
    expect(webhookMatchesEvent({ event: 'order.created', scope: '' }, 'order.created')).toBe(true);
    // Defensief: de runtime tolereert ook een null-scope (handmatig aangemaakte rij).
    expect(
      webhookMatchesEvent({ event: 'order.created', scope: null as unknown as string }, 'order.created'),
    ).toBe(true);
  });

  it('scope = categorie matcht het bijbehorende event maar niet een andere categorie', () => {
    expect(webhookMatchesEvent({ event: 'order.created', scope: 'order' }, 'order.created')).toBe(true);
    // event-veld zou matchen ('*'), maar de scope 'order' blokkeert een product-event.
    expect(webhookMatchesEvent({ event: '*', scope: 'order' }, 'product.created')).toBe(false);
  });
});
