/**
 * Geld- en datum-formattering. De API levert bedragen als string (numeric,
 * 4 decimalen). We tonen ze als nette bedragen in de locale/valuta van de shop
 * (val terug op nl-NL / EUR wanneer onbekend).
 */

const DEFAULT_LOCALE = 'nl-NL';
const DEFAULT_CURRENCY = 'EUR';

// Cache van Intl.NumberFormat-instanties (locale+currency) — niet on-elke-call
// een nieuwe aanmaken.
const moneyFmtCache = new Map<string, Intl.NumberFormat>();

function moneyFormatter(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let f = moneyFmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      // ongeldige locale/currency → veilige fallback
      f = new Intl.NumberFormat(DEFAULT_LOCALE, {
        style: 'currency',
        currency: DEFAULT_CURRENCY,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    moneyFmtCache.set(key, f);
  }
  return f;
}

/** Format een money-string (of null) naar bv. "€ 281,94" (nl-NL/EUR default). */
export function formatMoney(value: string | number | null | undefined): string {
  return formatMoneyIn(value, DEFAULT_LOCALE, DEFAULT_CURRENCY);
}

/** Als formatMoney, maar met expliciete shop-locale + valuta. */
export function formatMoneyIn(
  value: string | number | null | undefined,
  locale: string | null | undefined,
  currency: string | null | undefined,
): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return moneyFormatter(
    locale || DEFAULT_LOCALE,
    currency || DEFAULT_CURRENCY,
  ).format(n);
}

/** Format een ISO-datum naar bv. "22 mei 2026" (nl-NL default). */
export function formatDate(
  iso: string | null | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(locale || DEFAULT_LOCALE, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return d.toLocaleDateString(DEFAULT_LOCALE, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
}

/** True als compareAtPrice een echte (hogere) doorstreepprijs is. */
export function isOnSale(
  price: string | null | undefined,
  compareAt: string | null | undefined,
): boolean {
  if (!price || !compareAt) return false;
  return Number(compareAt) > Number(price);
}
