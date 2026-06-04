/**
 * OSS-CSV-generator — One-Stop-Shop kwartaalaangifte.
 *
 * De EU-OSS-aangifte rapporteert per (land van consumptie, BTW-tarief) het
 * belastbare bedrag + de verschuldigde BTW. Dit bestand benadert het
 * "Mijn Belastingdienst Zakelijk"-uploadformaat: één regel per land+tarief.
 *
 * V1: aggregatie mag mock/afgeleid zijn, maar de KOLOM-vorm klopt zodat de
 * frontend en de boekhouder er direct mee kunnen werken. Echte VIES-validatie
 * en de exacte ICP-kolommen zijn Fase 4.
 */

export interface OssRow {
  country: string; // land van consumptie (ISO-2)
  vatRate: number; // tarief in %
  taxableBase: string; // belastbaar bedrag (netto), 2-dec string
  vatAmount: string; // verschuldigde BTW, 2-dec string
  currency?: string; // default EUR
}

export interface OssCsvInput {
  period: string; // bv '2026-Q1'
  rows: OssRow[];
}

/** RFC-4180-achtig: quote bij komma/quote/newline, dubbel-quote escape. */
export function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const OSS_HEADER = [
  'period',
  'country_of_consumption',
  'vat_rate',
  'taxable_base',
  'vat_amount',
  'currency',
];

/**
 * Bouw een OSS-CSV-string (header + 1 regel per land+tarief). Regels worden
 * gesorteerd op land, dan tarief, voor een deterministische output.
 */
export function generateOssCsv(input: OssCsvInput): string {
  const sorted = [...input.rows].sort(
    (a, b) => a.country.localeCompare(b.country) || a.vatRate - b.vatRate,
  );
  const lines = [OSS_HEADER.join(',')];
  for (const r of sorted) {
    lines.push(
      [
        csvCell(input.period),
        csvCell(r.country),
        csvCell(r.vatRate.toFixed(2)),
        csvCell(r.taxableBase),
        csvCell(r.vatAmount),
        csvCell(r.currency ?? 'EUR'),
      ].join(','),
    );
  }
  // CRLF line-endings — gangbaar voor NL-Belastingdienst CSV-uploads.
  return lines.join('\r\n') + '\r\n';
}
