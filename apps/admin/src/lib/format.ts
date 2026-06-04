/**
 * Lichte format-helpers voor demo-pages.
 * Geen externe libs (date-fns/luxon) — pure JS met `Intl`.
 */

const EUR = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const EUR_NO_DECIMALS = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const PCT = new Intl.NumberFormat('nl-NL', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const NUM = new Intl.NumberFormat('nl-NL');

const DATE_SHORT = new Intl.DateTimeFormat('nl-NL', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const DATE_LONG = new Intl.DateTimeFormat('nl-NL', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const DATETIME = new Intl.DateTimeFormat('nl-NL', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatMoney(value: number, opts?: { decimals?: boolean }): string {
  if (opts?.decimals === false) return EUR_NO_DECIMALS.format(value);
  return EUR.format(value);
}

export function formatPct(fraction: number): string {
  // takes 0-1 (or 0-100 if abs > 1.5)
  const v = Math.abs(fraction) > 1.5 ? fraction / 100 : fraction;
  return PCT.format(v);
}

export function formatNumber(value: number): string {
  return NUM.format(value);
}

export function formatDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return DATE_SHORT.format(d);
}

export function formatDateLong(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return DATE_LONG.format(d);
}

export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return DATETIME.format(d);
}

/** Relatieve tijd ("2u geleden", "vandaag", "gisteren"). */
export function formatRelative(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'zojuist';
  if (diffMin < 60) return `${diffMin} min geleden`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}u geleden`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return 'gisteren';
  if (diffD < 7) return `${diffD} dagen geleden`;
  if (diffD < 30) return `${Math.round(diffD / 7)} wk geleden`;
  if (diffD < 365) return `${Math.round(diffD / 30)} mnd geleden`;
  return `${Math.round(diffD / 365)} jr geleden`;
}

/** Initialen uit een naam ("Jan de Vries" → "JV"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Bedrag met +/- prefix voor delta-display. */
export function formatDelta(value: number): string {
  if (value === 0) return '0';
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

/** Land-emoji-flag uit ISO-code (NL, DE, BE, FR, IT, ES, GB, US). */
export function countryFlag(iso2: string): string {
  const code = iso2.toUpperCase();
  if (code.length !== 2) return '';
  const A = 0x1f1e6;
  const ASCII_A = 65;
  return String.fromCodePoint(A + (code.charCodeAt(0) - ASCII_A)) +
    String.fromCodePoint(A + (code.charCodeAt(1) - ASCII_A));
}

/** Truncate string met ellipsis. */
export function truncate(s: string, len = 40): string {
  if (s.length <= len) return s;
  return s.slice(0, len - 1) + '…';
}
