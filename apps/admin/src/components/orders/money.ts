/**
 * Geld-helpers voor de orders-UI.
 *
 * De backend levert bedragen als **string** (`numeric(12,4)`, zie
 * orders/REGISTER.md → "geld = string"). De gedeelde `formatMoney` in
 * `lib/format.ts` verwacht een `number`. Deze wrapper parset veilig.
 */
import { formatMoney as formatMoneyNumber } from '@/lib/format';

/** Parse een money-string (of number/null) naar number. Null/leeg → 0. */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Render een money-string (backend-shape) als EUR. */
export function money(value: string | number | null | undefined, opts?: { decimals?: boolean }): string {
  return formatMoneyNumber(toNumber(value), opts);
}

/** Render een marge-percentage (backend levert 0-100 of null). */
export function marginPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)}%`;
}
