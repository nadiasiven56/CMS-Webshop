/**
 * Serializers — Drizzle-row → API-DTO voor finance-module.
 *
 *   - timestamp (Date) → ISO-string
 *   - date (string 'YYYY-MM-DD') → blijft string
 *   - numeric (string in pg-driver) → blijft string (Money)
 *   - jsonb shape stabiel houden
 */
import type {
  VatRate,
  LedgerEntry,
  Invoice,
  Payout,
  AccountingExport,
} from '../../db/schema/index.js';

export interface VatRateDto {
  id: string;
  country: string;
  taxClass: string;
  rate: string;
  label: string | null;
  validFrom: string;
}

export function toVatRateDto(r: VatRate): VatRateDto {
  return {
    id: r.id,
    country: r.country,
    taxClass: r.taxClass,
    rate: r.rate,
    label: r.label,
    validFrom: r.validFrom,
  };
}

export interface LedgerEntryDto {
  id: string;
  shopId: string | null;
  orderId: string | null;
  entryDate: string;
  account: string;
  debit: string;
  credit: string;
  currency: string;
  vatRate: string | null;
  vatCountry: string | null;
  channel: string | null;
  description: string | null;
  createdAt: string;
}

export function toLedgerEntryDto(e: LedgerEntry): LedgerEntryDto {
  return {
    id: e.id,
    shopId: e.shopId,
    orderId: e.orderId,
    entryDate: e.entryDate,
    account: e.account,
    debit: e.debit,
    credit: e.credit,
    currency: e.currency,
    vatRate: e.vatRate,
    vatCountry: e.vatCountry,
    channel: e.channel,
    description: e.description,
    createdAt: e.createdAt.toISOString(),
  };
}

export interface InvoiceDto {
  id: string;
  shopId: string;
  orderId: string | null;
  invoiceNumber: string;
  type: string;
  customer: Invoice['customer'];
  lines: unknown[];
  subtotal: string | null;
  vatTotal: string | null;
  total: string | null;
  status: string;
  hasUblXml: boolean;
  issuedAt: string;
  createdAt: string;
}

/** Lijst-DTO laat ublXml weg (kan groot zijn); detail levert het apart. */
export function toInvoiceDto(inv: Invoice): InvoiceDto {
  return {
    id: inv.id,
    shopId: inv.shopId,
    orderId: inv.orderId,
    invoiceNumber: inv.invoiceNumber,
    type: inv.type,
    customer: inv.customer,
    lines: inv.lines,
    subtotal: inv.subtotal,
    vatTotal: inv.vatTotal,
    total: inv.total,
    status: inv.status,
    hasUblXml: Boolean(inv.ublXml),
    issuedAt: inv.issuedAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
  };
}

export interface PayoutDto {
  id: string;
  channel: string | null;
  amount: string | null;
  period: string | null;
  reference: string | null;
  receivedAt: string | null;
  createdAt: string;
}

export function toPayoutDto(p: Payout): PayoutDto {
  return {
    id: p.id,
    channel: p.channel,
    amount: p.amount,
    period: p.period,
    reference: p.reference,
    receivedAt: p.receivedAt ? p.receivedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

export interface AccountingExportDto {
  id: string;
  type: string | null;
  period: string | null;
  status: string;
  filePath: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export function toAccountingExportDto(e: AccountingExport): AccountingExportDto {
  return {
    id: e.id,
    type: e.type,
    period: e.period,
    status: e.status,
    filePath: e.filePath,
    meta: e.meta,
    createdAt: e.createdAt.toISOString(),
  };
}
