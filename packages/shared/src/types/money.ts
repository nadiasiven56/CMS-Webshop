/**
 * Money — strikt rekenen met 4 decimalen.
 *
 * Bewuste keuze: alle bedragen als `string` over de wire (Postgres
 * `numeric(12,4)` -> string in postgres-js / Drizzle). NOOIT `number` /
 * `float` voor geld.
 *
 * Helpers hier zijn klein en framework-agnostisch zodat zowel API als
 * Admin-frontend ze kan gebruiken.
 */

const SCALE = 4;
const FACTOR = 10 ** SCALE;

/** Branded type — voorkom dat losse strings per ongeluk als Money worden behandeld */
export type Money = string & { readonly __brand: 'Money' };

/** Maak Money van een string of getal. Throws bij NaN / Infinity. */
export function money(input: string | number): Money {
  const n = typeof input === 'string' ? Number(input) : input;
  if (!Number.isFinite(n)) {
    throw new Error(`money: invalid number "${input}"`);
  }
  // Round-half-away-from-zero op 4 decimalen
  const rounded = Math.sign(n) * Math.round(Math.abs(n) * FACTOR) / FACTOR;
  return rounded.toFixed(SCALE) as Money;
}

export function add(a: Money, b: Money): Money {
  return money(Number(a) + Number(b));
}

export function sub(a: Money, b: Money): Money {
  return money(Number(a) - Number(b));
}

export function mul(a: Money, factor: number): Money {
  return money(Number(a) * factor);
}

export function div(a: Money, factor: number): Money {
  if (factor === 0) throw new Error('money.div: divide by zero');
  return money(Number(a) / factor);
}

export function eq(a: Money, b: Money): boolean {
  return a === b;
}

export function gt(a: Money, b: Money): boolean {
  return Number(a) > Number(b);
}

export function lt(a: Money, b: Money): boolean {
  return Number(a) < Number(b);
}

/** Format voor UI: '€ 1.234,56' (NL-locale). */
export function formatEUR(a: Money | string | number): string {
  const m = typeof a === 'string' && a.match(/^-?\d+\.\d+$/) ? a : money(a as string | number);
  const n = Number(m);
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export const ZERO: Money = money(0);
