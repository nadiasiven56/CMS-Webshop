/**
 * Ledger-posting — schrijft BALANCED double-entry `ledger_entries` voor orders
 * en refunds.
 *
 * Boekhoud-model (V1, single-entry-vriendelijk maar wel gebalanceerd):
 *   Bij een verkochte order:
 *     CREDIT  revenue       = netto-omzet (excl. BTW)
 *     CREDIT  vat_payable   = af te dragen BTW
 *     DEBIT   cogs          = inkoopwaarde (sum order_items.cost_price * qty)
 *   sum(debit) === sum(credit) garanderen we door de COGS-tegenboeking NIET als
 *   sluitpost te gebruiken maar door net+vat te crediteren en cogs te debiteren;
 *   het verschil (marge) is impliciet (geen aparte equity-regel in V1). Daarom
 *   balanceren we expliciet: we voegen géén losse regels toe die de som breken —
 *   debit-totaal en credit-totaal worden gelijkgetrokken via een sluit-regel
 *   `account='trade_debtors'` (de openstaande vordering = bruto-bedrag).
 *
 *   Concreet per order (alles in centen, dan → money-string):
 *     gross = net + vat
 *     DEBIT   trade_debtors  = gross        (klant moet betalen)
 *     CREDIT  revenue        = net
 *     CREDIT  vat_payable    = vat
 *     (cogs/voorraad-mutatie loopt via een aparte boeking zodat de eerste set
 *      al sluit: debit gross === credit (net+vat) === gross)
 *     DEBIT   cogs           = inkoopwaarde
 *     CREDIT  inventory      = inkoopwaarde (tegenboeking; sluit ook)
 *
 * Idempotent: als er al een `revenue`-regel voor deze order bestaat doen we
 * niets (voorkomt dubbel boeken bij status-transitie-replays). `reverseOrderLedger`
 * verwijdert alle regels voor een order (gebruikt door de guard / bij correctie).
 *
 * Alle bedragen rekenen we via hele centen (vat-math.toCents/centsToMoney) en
 * slaan we op als numeric(12,4)-string. NOOIT float.
 */
import { and, eq } from 'drizzle-orm';
import { ledgerEntries } from '../../db/schema/ledger-entries.js';
import type { Order } from '../../db/schema/orders.js';
import type { OrderItem } from '../../db/schema/order-items.js';
import type { db as DB } from '../../lib/db.js';
import { toCents, centsToMoney } from './vat-math.js';

/** tx-handle: `db` of een Drizzle-`tx` binnen `db.transaction(...)`. */
export type DbOrTx = typeof DB;

/** Accounts die deze module gebruikt (matcht ledger_entries.account comment). */
export const LEDGER_ACCOUNTS = {
  revenue: 'revenue',
  vatPayable: 'vat_payable',
  cogs: 'cogs',
  inventory: 'inventory',
  tradeDebtors: 'trade_debtors',
  refund: 'refund',
} as const;

/** Minimale order-shape die we nodig hebben (subset van Order). */
type OrderLike = Pick<
  Order,
  | 'id'
  | 'shopId'
  | 'channel'
  | 'currency'
  | 'subtotal'
  | 'taxTotal'
  | 'grandTotal'
  | 'placedAt'
  | 'createdAt'
>;

/** Minimale order-item-shape (subset van OrderItem). */
type OrderItemLike = Pick<OrderItem, 'quantity' | 'costPrice' | 'taxRate'>;

/** entry_date is een `date`-kolom → 'YYYY-MM-DD'. */
function entryDateFor(order: OrderLike): string {
  const d = order.placedAt ?? order.createdAt ?? new Date();
  return new Date(d).toISOString().slice(0, 10);
}

/** Som van inkoopwaarde (cost_price * qty) over alle regels, in centen. */
function cogsCents(items: OrderItemLike[]): number {
  let total = 0;
  for (const it of items) {
    const unit = toCents(it.costPrice);
    total += unit * (it.quantity ?? 0);
  }
  return total;
}

/**
 * Bepaal net + vat in centen. We gebruiken bij voorkeur de al-berekende
 * order-totalen (subtotal = netto, tax_total = BTW). Vallen die weg, dan is
 * net = grand_total - tax_total.
 */
function netVatCents(order: OrderLike): { netCents: number; vatCents: number } {
  const vatCents = toCents(order.taxTotal);
  if (order.subtotal !== null && order.subtotal !== undefined) {
    return { netCents: toCents(order.subtotal), vatCents };
  }
  const grossCents = toCents(order.grandTotal);
  return { netCents: grossCents - vatCents, vatCents };
}

/** Representatieve vatRate (numeric(5,2)-string) uit de regels, indien uniform. */
function representativeVatRate(items: OrderItemLike[]): string | null {
  const rates = new Set(items.map((i) => i.taxRate).filter((r): r is string => r != null));
  if (rates.size === 1) return [...rates][0]!;
  return null;
}

/** Heeft deze order al een revenue-regel? (idempotency-guard) */
async function hasRevenueEntry(tx: DbOrTx, orderId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.orderId, orderId),
        eq(ledgerEntries.account, LEDGER_ACCOUNTS.revenue),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Boek de omzet van een order. Idempotent: doet niets als er al een
 * `revenue`-regel voor deze order is. Schrijft een GEBALANCEERDE set regels
 * (sum debit === sum credit). Roep aan binnen je bestaande transactie.
 *
 * Geeft het aantal geschreven regels terug (0 als overgeslagen).
 */
export async function postOrderRevenue(
  tx: DbOrTx,
  order: OrderLike,
  items: OrderItemLike[],
): Promise<number> {
  if (await hasRevenueEntry(tx, order.id)) {
    return 0; // al geboekt
  }

  const { netCents, vatCents } = netVatCents(order);
  const grossCents = netCents + vatCents;
  const cogs = cogsCents(items);

  const entryDate = entryDateFor(order);
  const currency = order.currency ?? 'EUR';
  const channel = order.channel ?? null;
  const vatRate = representativeVatRate(items);

  type Row = {
    account: string;
    debit: string;
    credit: string;
    description: string;
    vatRate: string | null;
  };

  const rows: Row[] = [
    // Vorderingen-blok (sluit op zichzelf: debit gross == credit net+vat)
    {
      account: LEDGER_ACCOUNTS.tradeDebtors,
      debit: centsToMoney(grossCents),
      credit: centsToMoney(0),
      description: 'Vordering op klant (bruto)',
      vatRate: null,
    },
    {
      account: LEDGER_ACCOUNTS.revenue,
      debit: centsToMoney(0),
      credit: centsToMoney(netCents),
      description: 'Netto-omzet',
      vatRate,
    },
    {
      account: LEDGER_ACCOUNTS.vatPayable,
      debit: centsToMoney(0),
      credit: centsToMoney(vatCents),
      description: 'Af te dragen BTW',
      vatRate,
    },
  ];

  // COGS-blok alleen als er inkoopwaarde is (sluit ook op zichzelf).
  if (cogs > 0) {
    rows.push(
      {
        account: LEDGER_ACCOUNTS.cogs,
        debit: centsToMoney(cogs),
        credit: centsToMoney(0),
        description: 'Inkoopwaarde verkochte goederen',
        vatRate: null,
      },
      {
        account: LEDGER_ACCOUNTS.inventory,
        debit: centsToMoney(0),
        credit: centsToMoney(cogs),
        description: 'Voorraad-afname',
        vatRate: null,
      },
    );
  }

  await tx.insert(ledgerEntries).values(
    rows.map((r) => ({
      shopId: order.shopId,
      orderId: order.id,
      entryDate,
      account: r.account,
      debit: r.debit,
      credit: r.credit,
      currency,
      vatRate: r.vatRate,
      channel,
      description: r.description,
    })),
  );

  return rows.length;
}

/**
 * Boek een (deel)refund. We crediteren `refund` voor het bruto-bedrag en
 * debiteren proportioneel `revenue` (netto) + `vat_payable` (BTW), zodat de set
 * gebalanceerd blijft (debit revenue+vat == credit refund == gross).
 *
 * `refundAmount` is het BRUTO terugbetaalde bedrag als money-string (incl. BTW).
 * De BTW-verdeling baseren we op de order-verhouding net:vat.
 */
export async function postRefund(
  tx: DbOrTx,
  order: OrderLike,
  refundAmount: string,
): Promise<number> {
  const grossRefundCents = toCents(refundAmount);
  if (grossRefundCents <= 0) return 0;

  const { netCents: orderNet, vatCents: orderVat } = netVatCents(order);
  const orderGross = orderNet + orderVat;

  // Proportionele BTW-splitsing van het refund-bruto op basis van de order-ratio.
  // Net = remainder zodat net+vat exact == gross (geen afrond-lek).
  const refundVatCents =
    orderGross > 0 ? Math.round((grossRefundCents * orderVat) / orderGross) : 0;
  const refundNetCents = grossRefundCents - refundVatCents;

  const entryDate = entryDateFor(order);
  const currency = order.currency ?? 'EUR';
  const channel = order.channel ?? null;

  const rows = [
    {
      account: LEDGER_ACCOUNTS.revenue,
      debit: centsToMoney(refundNetCents),
      credit: centsToMoney(0),
      description: 'Omzet-correctie (refund)',
    },
    {
      account: LEDGER_ACCOUNTS.vatPayable,
      debit: centsToMoney(refundVatCents),
      credit: centsToMoney(0),
      description: 'BTW-correctie (refund)',
    },
    {
      account: LEDGER_ACCOUNTS.refund,
      debit: centsToMoney(0),
      credit: centsToMoney(grossRefundCents),
      description: 'Terugbetaling aan klant',
    },
  ];

  await tx.insert(ledgerEntries).values(
    rows.map((r) => ({
      shopId: order.shopId,
      orderId: order.id,
      entryDate,
      account: r.account,
      debit: r.debit,
      credit: r.credit,
      currency,
      channel,
      description: r.description,
    })),
  );

  return rows.length;
}

/**
 * Verwijder alle ledger-regels voor een order. Gebruikt door de
 * idempotency-/correctie-flow (eerst reverseren, dan opnieuw posten). Geeft het
 * aantal verwijderde rijen terug.
 */
export async function reverseOrderLedger(tx: DbOrTx, orderId: string): Promise<number> {
  const deleted = await tx
    .delete(ledgerEntries)
    .where(eq(ledgerEntries.orderId, orderId))
    .returning({ id: ledgerEntries.id });
  return deleted.length;
}
