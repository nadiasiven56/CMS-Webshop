/**
 * Gedeelde query-bouwstenen voor de analytics-module.
 *
 * Eén plek voor (a) de definitie van een "geldige/betaalde" order, (b) het
 * date-venster (default laatste 30 dagen, net als dashboard), (c) de gedeelde
 * order-WHERE-condities (shop/channel/financial-status + date-range), en (d) de
 * date_trunc-bucket-expressie voor de tijdreeks.
 *
 * Geld komt als `numeric(12,4)`-string uit de driver; we sommeren in HELE CENTEN
 * (`domain/finance/vat-math.ts`) zodat er geen float-drift ontstaat, en geven
 * naar buiten Money-strings ('1234.5600'). `subtotal` = omzet NET (excl. BTW),
 * exact zoals het dashboard rekent.
 *
 * Veiligheid: `interval` is een gevalideerde enum die als RAW literal in
 * date_trunc gaat (anders triggert Postgres 42803 in GROUP BY). Alle andere
 * user-input gaat via bound parameters (eq/gte/lte) — NOOIT string-interpolatie.
 */
import { and, eq, gte, lte, inArray, sql, type SQL } from 'drizzle-orm';
import { orders } from '../../db/schema/orders.js';
import type { Interval, BaseQuery } from './_schemas.js';

/**
 * Financiele statussen die als gerealiseerde omzet meetellen — identiek aan de
 * dashboard-definitie. Een order telt mee zodra hij betaald is (incl. (deels-)
 * gerefund, want de bruto-verkoop heeft plaatsgevonden; refunds rapporteren we
 * apart in /kpis).
 */
export const REVENUE_STATUSES = ['paid', 'partially_refunded', 'refunded'] as const;

/** Het opgeloste date-venster (UTC dag-grenzen) voor een request. */
export interface Window {
  fromDate: Date;
  toDate: Date;
}

/**
 * Los het [from,to]-venster op. Default = laatste 30 dagen (incl. vandaag),
 * exact zoals dashboard/kpis. `from`/`to` (YYYY-MM-DD) overschrijven het.
 */
export function resolveWindow(q: Pick<BaseQuery, 'from' | 'to'>, now: Date = new Date()): Window {
  const toDate = q.to ? new Date(`${q.to}T23:59:59.999Z`) : now;
  const fromDate = q.from
    ? new Date(`${q.from}T00:00:00.000Z`)
    : new Date(toDate.getTime() - 29 * 24 * 3600 * 1000);
  return { fromDate, toDate };
}

/**
 * Bouw de gedeelde order-condities: financial-status ∈ REVENUE_STATUSES +
 * optioneel shop_id + optioneel channel. Géén date-range (sommige aggregaties
 * willen de raw conds zónder venster). Alles via bound parameters.
 */
export function buildOrderConds(q: Pick<BaseQuery, 'shop_id' | 'channel'>): SQL[] {
  const conds: SQL[] = [inArray(orders.financialStatus, [...REVENUE_STATUSES])];
  if (q.shop_id) conds.push(eq(orders.shopId, q.shop_id));
  if (q.channel) conds.push(eq(orders.channel, q.channel));
  return conds;
}

/**
 * Gedeelde order-condities mét date-venster op `orders.created_at`. Dit is de
 * filter die (bijna) elk analytics-endpoint gebruikt zodat shop/channel/date
 * overal consistent werken.
 */
export function buildFilters(
  q: Pick<BaseQuery, 'shop_id' | 'channel' | 'from' | 'to'>,
  now: Date = new Date(),
): { conds: SQL[]; where: SQL; window: Window } {
  const window = resolveWindow(q, now);
  const conds = [
    ...buildOrderConds(q),
    gte(orders.createdAt, sql`${window.fromDate.toISOString()}::timestamptz`),
    lte(orders.createdAt, sql`${window.toDate.toISOString()}::timestamptz`),
  ];
  // and(...) over een niet-lege lijst levert altijd een SQL op.
  return { conds, where: and(...conds) as SQL, window };
}

/**
 * date_trunc-bucket op `orders.created_at` → 'YYYY-MM-DD' label per interval.
 * `interval` wordt als RAW literal geïnjecteerd (gevalideerde enum, veilig);
 * een geparametriseerde expressie zou Postgres 42803 ("must appear in GROUP BY")
 * triggeren omdat SELECT- en GROUP BY-expressie dan niet als gelijk gelden.
 */
export function periodBucket(interval: Interval): SQL<string> {
  return sql<string>`to_char(date_trunc('${sql.raw(interval)}', ${orders.createdAt}::timestamp), 'YYYY-MM-DD')`;
}
