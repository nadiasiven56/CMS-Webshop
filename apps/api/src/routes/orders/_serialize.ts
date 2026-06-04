/**
 * Serializers — Drizzle-row → API-DTO voor het orders-domein.
 *
 * Conventie (zie WAVE1-BACKEND-CONTRACT.md):
 *   - timestamps → `.toISOString()`
 *   - numeric (string in pg-driver) blijft string ("geld = string")
 *   - jsonb-shapes blijven stabiel
 */
import type {
  Order,
  OrderItem,
  OrderPayment,
  OrderFulfillment,
  Return,
  ReturnItem,
} from '../../db/schema/index.js';

// ─── Order core ──────────────────────────────────────────────

export interface OrderCoreDto {
  id: string;
  shopId: string;
  orderNumber: string;
  customerId: string | null;
  email: string | null;
  channel: string;
  status: string;
  financialStatus: string;
  fulfillmentStatus: string;
  currency: string;
  subtotal: string | null;
  discountTotal: string;
  shippingTotal: string;
  taxTotal: string;
  grandTotal: string | null;
  billingAddress: unknown;
  shippingAddress: unknown;
  note: string | null;
  placedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toOrderCore(o: Order): OrderCoreDto {
  return {
    id: o.id,
    shopId: o.shopId,
    orderNumber: o.orderNumber,
    customerId: o.customerId,
    email: o.email,
    channel: o.channel,
    status: o.status,
    financialStatus: o.financialStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    currency: o.currency,
    subtotal: o.subtotal,
    discountTotal: o.discountTotal,
    shippingTotal: o.shippingTotal,
    taxTotal: o.taxTotal,
    grandTotal: o.grandTotal,
    billingAddress: o.billingAddress ?? null,
    shippingAddress: o.shippingAddress ?? null,
    note: o.note,
    placedAt: o.placedAt ? o.placedAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

// ─── Order item ──────────────────────────────────────────────

export interface OrderItemDto {
  id: string;
  orderId: string;
  variantId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  unitPrice: string | null;
  taxRate: string;
  taxAmount: string;
  costPrice: string | null;
  lineTotal: string | null;
  /** Marge per regel (lineTotal-ex-vat minus cost*qty). null als costPrice ontbreekt. */
  margin: string | null;
  marginPct: number | null;
}

export function toOrderItemDto(i: OrderItem, margin: string | null, marginPct: number | null): OrderItemDto {
  return {
    id: i.id,
    orderId: i.orderId,
    variantId: i.variantId,
    sku: i.sku,
    title: i.title,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    taxRate: i.taxRate,
    taxAmount: i.taxAmount,
    costPrice: i.costPrice,
    lineTotal: i.lineTotal,
    margin,
    marginPct,
  };
}

// ─── Payment ─────────────────────────────────────────────────

export interface OrderPaymentDto {
  id: string;
  orderId: string;
  provider: string | null;
  amount: string | null;
  status: string;
  reference: string | null;
  paidAt: string | null;
  createdAt: string;
}

export function toOrderPaymentDto(p: OrderPayment): OrderPaymentDto {
  return {
    id: p.id,
    orderId: p.orderId,
    provider: p.provider,
    amount: p.amount,
    status: p.status,
    reference: p.reference,
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

// ─── Fulfillment ─────────────────────────────────────────────

export interface OrderFulfillmentDto {
  id: string;
  orderId: string;
  locationId: string | null;
  status: string;
  carrier: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  createdAt: string;
}

export function toOrderFulfillmentDto(f: OrderFulfillment): OrderFulfillmentDto {
  return {
    id: f.id,
    orderId: f.orderId,
    locationId: f.locationId,
    status: f.status,
    carrier: f.carrier,
    trackingCode: f.trackingCode,
    trackingUrl: f.trackingUrl,
    shippedAt: f.shippedAt ? f.shippedAt.toISOString() : null,
    createdAt: f.createdAt.toISOString(),
  };
}

// ─── Return / RMA ────────────────────────────────────────────

export interface ReturnItemDto {
  id: string;
  returnId: string;
  orderItemId: string | null;
  quantity: number | null;
  restock: boolean;
}

export function toReturnItemDto(ri: ReturnItem): ReturnItemDto {
  return {
    id: ri.id,
    returnId: ri.returnId,
    orderItemId: ri.orderItemId,
    quantity: ri.quantity,
    restock: ri.restock,
  };
}

export interface ReturnDto {
  id: string;
  shopId: string;
  orderId: string | null;
  status: string;
  reason: string | null;
  refundAmount: string;
  createdAt: string;
  updatedAt: string;
  items?: ReturnItemDto[];
}

export function toReturnDto(r: Return, items?: ReturnItem[]): ReturnDto {
  return {
    id: r.id,
    shopId: r.shopId,
    orderId: r.orderId,
    status: r.status,
    reason: r.reason,
    refundAmount: r.refundAmount,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(items ? { items: items.map(toReturnItemDto) } : {}),
  };
}
