/**
 * Pure reken-helpers voor het orders-domein. Framework-agnostisch en zonder
 * DB-toegang zodat ze in vitest direct te unit-testen zijn.
 *
 * "Geld = string" — we rekenen via de Money-helper uit
 * `@webshop-crm/shared` (numeric(12,4) over de wire). NOOIT parseFloat voor
 * waarden die teruggeschreven worden.
 */
import {
  money,
  add,
  sub,
  mul,
  ZERO,
  type Money,
} from '@webshop-crm/shared/types/money';

/** Input voor 1 order-regel bij het berekenen van totalen. */
export interface LineInput {
  quantity: number;
  unitPrice: string; // ex-btw stuksprijs
  taxRate: string; // percentage, bv '21'
  costPrice?: string | null;
}

/** Berekend resultaat per regel. */
export interface LineComputed {
  quantity: number;
  unitPrice: Money;
  taxRate: string;
  /** ex-btw regeltotaal = unitPrice * quantity */
  lineNet: Money;
  /** btw-bedrag over de regel */
  taxAmount: Money;
  /** incl-btw regeltotaal (= lineNet + taxAmount) — opgeslagen als line_total */
  lineTotal: Money;
  costPrice: Money | null;
  /** marge = lineNet - (costPrice * quantity). null als costPrice ontbreekt. */
  margin: Money | null;
  /** marge als percentage van lineNet (afgerond op 2 dec). null bij geen cost / lineNet 0. */
  marginPct: number | null;
}

/** Totalen over een hele order. */
export interface OrderTotals {
  subtotal: Money; // som van lineNet (ex-btw)
  taxTotal: Money; // som van taxAmount
  grandTotal: Money; // subtotal + taxTotal + shipping - discount
}

/**
 * Bereken één regel: net, btw, incl-totaal en marge.
 * taxRate is een percentage-string ('21' -> 21%).
 */
export function computeLine(input: LineInput): LineComputed {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error(`computeLine: quantity must be a positive integer, got ${input.quantity}`);
  }
  const unitPrice = money(input.unitPrice);
  const lineNet = mul(unitPrice, input.quantity);

  const rate = Number(input.taxRate);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error(`computeLine: invalid taxRate "${input.taxRate}"`);
  }
  const taxAmount = mul(lineNet, rate / 100);
  const lineTotal = add(lineNet, taxAmount);

  let costPrice: Money | null = null;
  let margin: Money | null = null;
  let marginPct: number | null = null;
  if (input.costPrice != null && input.costPrice !== '') {
    costPrice = money(input.costPrice);
    const costTotal = mul(costPrice, input.quantity);
    margin = sub(lineNet, costTotal);
    const net = Number(lineNet);
    marginPct = net !== 0 ? Math.round((Number(margin) / net) * 10000) / 100 : null;
  }

  return {
    quantity: input.quantity,
    unitPrice,
    taxRate: String(rate),
    lineNet,
    taxAmount,
    lineTotal,
    costPrice,
    margin,
    marginPct,
  };
}

/**
 * Bereken order-totalen uit de regels + shipping/discount.
 * grand_total = subtotal(ex) + tax_total + shipping_total - discount_total.
 */
export function computeOrderTotals(
  lines: LineComputed[],
  opts: { shippingTotal?: string; discountTotal?: string } = {},
): OrderTotals {
  let subtotal: Money = ZERO;
  let taxTotal: Money = ZERO;
  for (const l of lines) {
    subtotal = add(subtotal, l.lineNet);
    taxTotal = add(taxTotal, l.taxAmount);
  }
  const shipping = opts.shippingTotal ? money(opts.shippingTotal) : ZERO;
  const discount = opts.discountTotal ? money(opts.discountTotal) : ZERO;
  let grandTotal = add(subtotal, taxTotal);
  grandTotal = add(grandTotal, shipping);
  grandTotal = sub(grandTotal, discount);
  return { subtotal, taxTotal, grandTotal };
}

/**
 * Marge over de héle order (som van regel-marges). Regels zonder costPrice
 * tellen niet mee voor de marge maar wél voor `hasMissingCost`-signaal.
 */
export function computeOrderMargin(lines: LineComputed[]): {
  margin: Money | null;
  marginPct: number | null;
  hasMissingCost: boolean;
} {
  let margin: Money = ZERO;
  let net: Money = ZERO;
  let anyCost = false;
  let hasMissingCost = false;
  for (const l of lines) {
    if (l.margin != null) {
      anyCost = true;
      margin = add(margin, l.margin);
      net = add(net, l.lineNet);
    } else {
      hasMissingCost = true;
    }
  }
  if (!anyCost) return { margin: null, marginPct: null, hasMissingCost };
  const netNum = Number(net);
  const marginPct = netNum !== 0 ? Math.round((Number(margin) / netNum) * 10000) / 100 : null;
  return { margin, marginPct, hasMissingCost };
}
