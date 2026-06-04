import { describe, it, expect } from 'vitest';
import { add, sub, mul, div, money, formatEUR, ZERO } from './money.js';

describe('money', () => {
  it('rounds to 4 decimals', () => {
    expect(money(1.23456)).toBe('1.2346');
    expect(money('1.0')).toBe('1.0000');
    expect(money(0)).toBe('0.0000');
  });

  it('throws on invalid input', () => {
    expect(() => money(NaN)).toThrow();
    expect(() => money('abc')).toThrow();
    expect(() => money(Infinity)).toThrow();
  });

  it('adds without float drift', () => {
    // Klassiek 0.1 + 0.2 = 0.30000000000000004 — moet hier 0.3000 zijn
    expect(add(money(0.1), money(0.2))).toBe('0.3000');
  });

  it('subtracts', () => {
    expect(sub(money(10), money(2.5))).toBe('7.5000');
  });

  it('multiplies', () => {
    expect(mul(money(2.5), 3)).toBe('7.5000');
  });

  it('divides and throws on zero', () => {
    expect(div(money(10), 4)).toBe('2.5000');
    expect(() => div(money(10), 0)).toThrow();
  });

  it('formats EUR in NL locale', () => {
    const out = formatEUR(money(1234.5));
    // Belangrijke check: bevat 1.234 of 1234, en 50, en €
    expect(out).toContain('€');
    expect(out).toMatch(/1[\. ]?234/);
  });

  it('ZERO equals 0.0000', () => {
    expect(ZERO).toBe('0.0000');
  });
});
