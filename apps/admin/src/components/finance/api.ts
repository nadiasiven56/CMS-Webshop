/**
 * React-Query hooks + DTO-types voor de finance-module (`/api/finance/*`).
 *
 * Centraal punt zodat finance/ledger/accounting dezelfde caching + types delen.
 * Alle bedragen blijven string (Money) — render via `formatMoney(Number(x))`.
 * Shop-scoping via `shop_id`-query (uit `useActiveShop()`).
 */
import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── Types (spiegelen de backend-DTO's in routes/finance/_serialize.ts) ───

export type Period = 'day' | 'week' | 'month';
export type AggSource = 'orders' | 'ledger';

/** Eén bucket uit /ledger/aggregate (source=orders heeft extra velden). */
export interface AggregateRow {
  period: string;
  shopId: string | null;
  channel: string | null;
  revenue: string;
  vat: string;
  cogs: string;
  margin: string;
  marginPct: number;
  // alleen source=orders:
  orderCount?: number;
  shipping?: string;
  grossTotal?: string;
}

export interface AggregateResponse {
  source: AggSource;
  period: Period;
  items: AggregateRow[];
  total: number;
}

export interface PnlResponse {
  shopId: string | null;
  period: { from: string | null; to: string | null };
  orderCount: number;
  revenueNet: string;
  discount: string;
  shipping: string;
  cogs: string;
  grossMargin: string;
  grossMarginPct: number;
  vat: string;
  grandTotal: string;
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

export interface LedgerListResponse {
  items: LedgerEntryDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface InvoiceCustomer {
  name?: string;
  company?: string;
  vatNumber?: string;
  email?: string;
  address?: {
    line1?: string;
    line2?: string;
    postcode?: string;
    city?: string;
    province?: string;
    country?: string;
  };
}

export interface InvoiceLine {
  id?: number;
  sku?: string;
  title?: string;
  quantity?: number;
  unitPrice?: string;
  taxRate?: number;
  taxAmount?: string;
  lineTotal?: string;
}

export interface InvoiceDto {
  id: string;
  shopId: string;
  orderId: string | null;
  invoiceNumber: string;
  type: string;
  customer: InvoiceCustomer | null;
  lines: InvoiceLine[];
  subtotal: string | null;
  vatTotal: string | null;
  total: string | null;
  status: string;
  hasUblXml: boolean;
  issuedAt: string;
  createdAt: string;
}

export interface InvoiceDetailDto extends InvoiceDto {
  ublXml: string | null;
}

export interface InvoiceListResponse {
  items: InvoiceDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface VatRateDto {
  id: string;
  country: string;
  taxClass: string;
  rate: string;
  label: string | null;
  validFrom: string;
}

// ─── Query-keys ────────────────────────────────────────────────

export const FINANCE_KEYS = {
  all: ['finance'] as const,
  pnl: (shopId: string | null, from?: string, to?: string, channel?: string | null) =>
    ['finance', 'pnl', shopId, from ?? null, to ?? null, channel ?? null] as const,
  aggregate: (
    shopId: string | null,
    period: Period,
    source: AggSource,
    from?: string,
    to?: string,
    channel?: string | null,
  ) =>
    ['finance', 'aggregate', shopId, period, source, from ?? null, to ?? null, channel ?? null] as const,
  ledger: (shopId: string | null, filters: LedgerFilters) =>
    ['finance', 'ledger', shopId, filters] as const,
  invoices: (shopId: string | null, filters: InvoiceFilters) =>
    ['finance', 'invoices', shopId, filters] as const,
  invoice: (id: string) => ['finance', 'invoice', id] as const,
  vatRates: ['finance', 'vat-rates'] as const,
};

// ─── P&L ───────────────────────────────────────────────────────

export interface PnlParams {
  /** Actieve shop. Bij `allShops` wordt deze genegeerd (geconsolideerd). */
  shopId: string | null;
  from?: string;
  to?: string;
  /** Optioneel kanaal-filter (web/bol/amazon/…). */
  channel?: string | null;
  /** Alle shops consolideren → `shop_id` wordt weggelaten uit de query. */
  allShops?: boolean;
  /** Override op de standaard-gating (default: shop gekozen óf allShops). */
  enabled?: boolean;
}

export function usePnl({ shopId, from, to, channel, allShops = false, enabled }: PnlParams) {
  const effectiveShopId = allShops ? null : shopId;
  return useQuery({
    queryKey: FINANCE_KEYS.pnl(effectiveShopId, from, to, channel),
    queryFn: async (): Promise<PnlResponse> =>
      (
        await api.get<PnlResponse>('/finance/pnl', {
          params: { shop_id: effectiveShopId ?? undefined, from, to, channel: channel || undefined },
        })
      ).data,
    enabled: enabled ?? (allShops || !!shopId),
    placeholderData: keepPreviousData,
  });
}

// ─── Aggregate (per kanaal / trend) ────────────────────────────

export interface AggregateParams {
  /** Actieve shop. Bij `allShops` wordt deze genegeerd (geconsolideerd). */
  shopId: string | null;
  period: Period;
  source?: AggSource;
  from?: string;
  to?: string;
  /** Optioneel kanaal-filter (web/bol/amazon/…). */
  channel?: string | null;
  /** Alle shops consolideren → `shop_id` wordt weggelaten uit de query. */
  allShops?: boolean;
  /** Override op de standaard-gating (default: shop gekozen óf allShops). */
  enabled?: boolean;
}

export function useAggregate({
  shopId,
  period,
  source = 'orders',
  from,
  to,
  channel,
  allShops = false,
  enabled,
}: AggregateParams) {
  const effectiveShopId = allShops ? null : shopId;
  return useQuery({
    queryKey: FINANCE_KEYS.aggregate(effectiveShopId, period, source, from, to, channel),
    queryFn: async (): Promise<AggregateResponse> =>
      (
        await api.get<AggregateResponse>('/finance/ledger/aggregate', {
          params: {
            shop_id: effectiveShopId ?? undefined,
            period,
            source,
            from,
            to,
            channel: channel || undefined,
          },
        })
      ).data,
    enabled: enabled ?? (allShops || !!shopId),
    placeholderData: keepPreviousData,
  });
}

// ─── Ledger-lijst ──────────────────────────────────────────────

export interface LedgerFilters {
  account?: string;
  channel?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function useLedger(shopId: string | null, filters: LedgerFilters) {
  return useQuery({
    queryKey: FINANCE_KEYS.ledger(shopId, filters),
    queryFn: async (): Promise<LedgerListResponse> =>
      (
        await api.get<LedgerListResponse>('/finance/ledger', {
          params: {
            shop_id: shopId ?? undefined,
            account: filters.account || undefined,
            channel: filters.channel || undefined,
            from: filters.from || undefined,
            to: filters.to || undefined,
            limit: filters.limit ?? 100,
            offset: filters.offset ?? 0,
          },
        })
      ).data,
    enabled: !!shopId,
    placeholderData: keepPreviousData,
  });
}

// ─── Invoices ──────────────────────────────────────────────────

export interface InvoiceFilters {
  status?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export function useInvoices(shopId: string | null, filters: InvoiceFilters) {
  return useQuery({
    queryKey: FINANCE_KEYS.invoices(shopId, filters),
    queryFn: async (): Promise<InvoiceListResponse> =>
      (
        await api.get<InvoiceListResponse>('/finance/invoices', {
          params: {
            shop_id: shopId ?? undefined,
            status: filters.status || undefined,
            type: filters.type || undefined,
            limit: filters.limit ?? 50,
            offset: filters.offset ?? 0,
          },
        })
      ).data,
    enabled: !!shopId,
    placeholderData: keepPreviousData,
  });
}

export function useInvoiceDetail(id: string | null) {
  return useQuery({
    queryKey: FINANCE_KEYS.invoice(id ?? '__none__'),
    queryFn: async (): Promise<InvoiceDetailDto> =>
      (await api.get<{ invoice: InvoiceDetailDto }>(`/finance/invoices/${id}`)).data.invoice,
    enabled: !!id,
  });
}

// ─── Exports (download-body) ───────────────────────────────────

export interface UblExportParams {
  invoiceId: string;
  persist?: boolean;
}

/** POST /finance/exports/ubl → UBL 2.1-XML als string (download-body). */
export function useUblExport() {
  return useMutation({
    mutationFn: async ({ invoiceId, persist = true }: UblExportParams): Promise<string> => {
      const res = await api.post('/finance/exports/ubl', {
        invoice_id: invoiceId,
        persist,
      }, { responseType: 'text' });
      return typeof res.data === 'string' ? res.data : String(res.data);
    },
  });
}

export interface OssExportParams {
  period: string; // YYYY-Q[1-4]
  shopId?: string | null;
}

/** POST /finance/exports/oss → OSS-CSV als string (download-body). */
export function useOssExport() {
  return useMutation({
    mutationFn: async ({ period, shopId }: OssExportParams): Promise<string> => {
      const res = await api.post('/finance/exports/oss', {
        period,
        shop_id: shopId ?? undefined,
      }, { responseType: 'text' });
      return typeof res.data === 'string' ? res.data : String(res.data);
    },
  });
}

// ─── BTW-tarieven (referentie) ─────────────────────────────────

export function useVatRates() {
  return useQuery({
    queryKey: FINANCE_KEYS.vatRates,
    queryFn: async (): Promise<VatRateDto[]> =>
      (await api.get<{ items: VatRateDto[] }>('/finance/vat-rates')).data.items ?? [],
    staleTime: 60_000,
  });
}

// ─── Helpers ───────────────────────────────────────────────────

/** Money-string → number (voor formatMoney). Tolerant voor null. */
export function money(v: string | null | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Verkoopkanalen voor het kanaal-filter. `''` = alle kanalen.
 * Houd in sync met `orders.channel` / `ledger_entries.channel` in de backend.
 */
export const SALES_CHANNELS: Array<{ value: string; label: string }> = [
  { value: 'web', label: 'Webshop' },
  { value: 'bol', label: 'Bol.com' },
  { value: 'amazon', label: 'Amazon' },
];

/**
 * Som van een set aggregate-rows → PnlResponse-vorm.
 *
 * Waarom: zowel `/pnl` als `/aggregate` rekenen uit `orders`, maar `/pnl`
 * accepteert GEEN kanaal-filter (de `channel`-query wordt genegeerd). Om de
 * KPI's, de per-kanaal-tabel én de P&L-tabel consistent te houden bij een
 * actief shop-/kanaal-filter, leiden we de samenvatting af uit dezelfde
 * (correct gegroepeerde) aggregate-rows. Alles in hele centen → geen drift.
 *
 * `discount` zit niet in de aggregate; geef die desgewenst los mee (uit `/pnl`
 * wanneer er geen kanaal-filter actief is). Default '0.0000'.
 */
export function derivePnlFromAggregate(
  rows: AggregateRow[] | undefined,
  opts: { shopId?: string | null; from?: string | null; to?: string | null; discount?: string } = {},
): PnlResponse {
  let revenueCents = 0;
  let vatCents = 0;
  let cogsCents = 0;
  let shippingCents = 0;
  let grandCents = 0;
  let orderCount = 0;
  for (const r of rows ?? []) {
    revenueCents += Math.round(money(r.revenue) * 100);
    vatCents += Math.round(money(r.vat) * 100);
    cogsCents += Math.round(money(r.cogs) * 100);
    shippingCents += Math.round(money(r.shipping) * 100);
    grandCents += Math.round(money(r.grossTotal) * 100);
    orderCount += r.orderCount ?? 0;
  }
  const marginCents = revenueCents - cogsCents;
  const c2 = (cents: number) => (cents / 100).toFixed(4);
  return {
    shopId: opts.shopId ?? null,
    period: { from: opts.from ?? null, to: opts.to ?? null },
    orderCount,
    revenueNet: c2(revenueCents),
    discount: opts.discount ?? '0.0000',
    shipping: c2(shippingCents),
    cogs: c2(cogsCents),
    grossMargin: c2(marginCents),
    grossMarginPct: revenueCents > 0 ? Math.round((marginCents / revenueCents) * 1000) / 10 : 0,
    vat: c2(vatCents),
    grandTotal: c2(grandCents),
  };
}

/** Kanaal-slug → leesbaar label. Onbekende slug → titlecased fallback. */
export function channelLabel(slug: string | null | undefined): string {
  if (!slug) return 'Direct';
  const known: Record<string, string> = {
    storefront: 'Webshop',
    web: 'Webshop',
    pos: 'Kassa',
    bol: 'Bol.com',
    amazon: 'Amazon',
    'amazon-nl': 'Amazon NL',
    marktplaats: 'Marktplaats',
  };
  if (known[slug]) return known[slug]!;
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
