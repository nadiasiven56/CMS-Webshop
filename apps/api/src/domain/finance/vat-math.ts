/**
 * BTW-rekenkern — strikt integer (hele centen) zodat er GEEN float-drift
 * ontstaat. Alle bedragen komen als `numeric(12,4)`-string uit de driver; we
 * converteren naar centen (×100, round-half-away-from-zero), rekenen, en
 * formatteren terug naar een 4-decimalen-string compatibel met de Money-helper.
 *
 * Bewuste keuze: hier NIET de Money-helper (die rekent via Number) gebruiken
 * voor sommaties — bij grote aggregaties stapelt float-fout op. Centen-integers
 * zijn exact. We exposen wel hetzelfde string-formaat ('1234.5600').
 */

/** numeric(12,4)-string → hele centen (integer). null/undefined → 0. */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return 0;
  // round-half-away-from-zero op centen
  return Math.sign(n) * Math.round(Math.abs(n) * 100);
}

/** Hele centen → numeric(12,4)-string ('1234.5600'). */
export function centsToMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}${euros}.${String(rest).padStart(2, '0')}00`;
}

/**
 * Splits een BTW-inclusief of -exclusief bedrag in (net, vat).
 *
 * @param amountCents  het basisbedrag in centen
 * @param ratePct      tarief als percentage (21 = 21%)
 * @param inclusive    of `amountCents` al BTW bevat (NL B2C-prijzen meestal incl.)
 * @returns {net, vat} beide in centen, net+vat === gross (consistent)
 */
export function splitVat(
  amountCents: number,
  ratePct: number,
  inclusive: boolean,
): { netCents: number; vatCents: number; grossCents: number } {
  if (ratePct <= 0) {
    return { netCents: amountCents, vatCents: 0, grossCents: amountCents };
  }
  if (inclusive) {
    // gross = amount; net = gross / (1 + r); vat = gross - net
    const gross = amountCents;
    const net = Math.round((gross * 100) / (100 + ratePct));
    return { netCents: net, vatCents: gross - net, grossCents: gross };
  }
  // exclusive: net = amount; vat = net * r; gross = net + vat
  const net = amountCents;
  const vat = Math.round((net * ratePct) / 100);
  return { netCents: net, vatCents: vat, grossCents: net + vat };
}

/** Marge in centen = revenue(net) − cogs. Beide al netto verwacht. */
export function marginCents(revenueNetCents: number, cogsCents: number): number {
  return revenueNetCents - cogsCents;
}

/** Marge-percentage (0–100, 1 decimaal). 0 bij revenue 0. */
export function marginPct(revenueNetCents: number, cogsCents: number): number {
  if (revenueNetCents === 0) return 0;
  return Math.round(((revenueNetCents - cogsCents) / revenueNetCents) * 1000) / 10;
}
