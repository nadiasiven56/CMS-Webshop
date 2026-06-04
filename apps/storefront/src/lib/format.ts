/**
 * Geld-formattering. De API levert bedragen als string (numeric, 4 decimalen).
 * We tonen ze als nette EUR-bedragen.
 */

const fmt = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format een money-string (of null) naar bv. "€ 281,94". */
export function formatMoney(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return fmt.format(n);
}

/** Format een ISO-datum naar bv. "22 mei 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** True als compareAtPrice een echte (hogere) doorstreepprijs is. */
export function isOnSale(
  price: string | null | undefined,
  compareAt: string | null | undefined,
): boolean {
  if (!price || !compareAt) return false;
  return Number(compareAt) > Number(price);
}
