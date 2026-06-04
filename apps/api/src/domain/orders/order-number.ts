/**
 * Per-shop oplopend order_number, bv 'CR-1001'.
 *
 * - Prefix = eerste 2 alfanumerieke letters van de shop-slug, uppercase
 *   ('crema' → 'CR', 'pawfect' → 'PA'). Fallback 'OR' als slug leeg/raar.
 * - Volgnummer start bij 1001 en telt per shop op (max bestaand + 1).
 * - Berekend binnen de transactie zodat de UNIQUE(shop_id, order_number)
 *   constraint de laatste vangnet is bij een race.
 */
import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../stock/available-recompute.js';
import { orders } from '../../db/schema/orders.js';

const START_SEQ = 1000; // eerste order wordt START_SEQ + 1 = 1001

export function orderNumberPrefix(slug: string): string {
  const letters = (slug || '').replace(/[^a-z0-9]/gi, '');
  if (letters.length === 0) return 'OR';
  return letters.slice(0, 2).toUpperCase();
}

/**
 * Bepaal het volgende order_number voor een shop. Leest het hoogste
 * bestaande numerieke suffix met diezelfde prefix en telt 1 op.
 */
export async function nextOrderNumber(
  tx: DbOrTx,
  shopId: string,
  shopSlug: string,
): Promise<string> {
  const prefix = orderNumberPrefix(shopSlug);
  // Hoogste numerieke suffix voor deze shop+prefix. We strippen de prefix en
  // casten naar int; non-matchende order_numbers tellen niet mee.
  const pattern = `${prefix}-%`;
  const [row] = await tx
    .select({
      maxSeq: sql<number>`coalesce(max((regexp_replace(${orders.orderNumber}, '^[A-Za-z]+-', ''))::int), ${START_SEQ})`,
    })
    .from(orders)
    .where(
      sql`${orders.shopId} = ${shopId} and ${orders.orderNumber} like ${pattern} and ${orders.orderNumber} ~ ('^' || ${prefix} || '-[0-9]+$')`,
    );

  const next = (row?.maxSeq ?? START_SEQ) + 1;
  return `${prefix}-${next}`;
}
