/**
 * Zod-validatie-schemas voor de orders-routes. Lokaal gehouden (orders is een
 * Wave-1 module) — kan later naar `@webshop-crm/shared` worden gepromoot.
 */
import { z } from 'zod';
import { ORDER_STATUSES } from '../../domain/orders/status-machine.js';

const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v.trim()), { message: 'invalid money value' });

export const AddressSchema = z
  .object({
    name: z.string().optional(),
    company: z.string().optional(),
    line1: z.string().optional(),
    line2: z.string().optional(),
    postcode: z.string().optional(),
    city: z.string().optional(),
    province: z.string().optional(),
    country: z.string().length(2).optional(),
    phone: z.string().optional(),
  })
  .strict();

// ─── List query ──────────────────────────────────────────────

export const ListQuerySchema = z.object({
  shop_id: z.string().uuid().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  financial_status: z.string().trim().min(1).optional(),
  fulfillment_status: z.string().trim().min(1).optional(),
  channel: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ─── Create order ────────────────────────────────────────────

export const OrderItemInputSchema = z.object({
  variantId: z.string().uuid().optional().nullable(),
  sku: z.string().trim().min(1).max(255).optional().nullable(),
  title: z.string().trim().min(1).max(512).optional().nullable(),
  quantity: z.number().int().min(1),
  unitPrice: moneyString,
  taxRate: moneyString.optional().default('21'),
  costPrice: moneyString.optional().nullable(),
});

export const OrderCreateSchema = z.object({
  shopId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
  email: z.string().email().optional().nullable(),
  channel: z.enum(['web', 'bol', 'amazon', 'gmc']).optional().default('web'),
  currency: z.string().length(3).optional(),
  items: z.array(OrderItemInputSchema).min(1),
  shippingTotal: moneyString.optional(),
  discountTotal: moneyString.optional(),
  billingAddress: AddressSchema.optional().nullable(),
  shippingAddress: AddressSchema.optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  /** Markeer order direct als geplaatst (zet placed_at). */
  placed: z.boolean().optional().default(false),
});

// ─── Status update ───────────────────────────────────────────

export const StatusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(2000).optional(),
});

// ─── Fulfillment ─────────────────────────────────────────────

export const FulfillmentCreateSchema = z.object({
  locationId: z.string().uuid().optional().nullable(),
  carrier: z.string().trim().min(1).max(128).optional().nullable(),
  trackingCode: z.string().trim().min(1).max(255).optional().nullable(),
  trackingUrl: z.string().trim().url().max(1024).optional().nullable(),
  status: z.enum(['pending', 'shipped', 'delivered']).optional().default('shipped'),
  /** Markeer ook de order als shipped (default true bij status=shipped). */
  markShipped: z.boolean().optional(),
});

// ─── Payment ─────────────────────────────────────────────────

export const PaymentCreateSchema = z.object({
  provider: z.enum(['mock', 'ideal', 'card', 'bol']).optional().default('mock'),
  amount: moneyString,
  status: z.enum(['pending', 'paid', 'failed', 'refunded']).optional().default('paid'),
  reference: z.string().trim().max(255).optional().nullable(),
  /** Zet order op 'paid' als deze betaling de grand_total dekt (default true bij status=paid). */
  markPaid: z.boolean().optional(),
});

// ─── Returns / RMA ───────────────────────────────────────────

export const ReturnItemInputSchema = z.object({
  orderItemId: z.string().uuid().optional().nullable(),
  quantity: z.number().int().min(1).optional().nullable(),
  restock: z.boolean().optional().default(true),
});

export const ReturnCreateSchema = z.object({
  /** Bij /api/returns verplicht; bij /api/orders/:id/returns afgeleid uit param. */
  shopId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional().nullable(),
  reason: z.string().trim().max(2000).optional().nullable(),
  refundAmount: moneyString.optional(),
  status: z
    .enum(['requested', 'approved', 'received', 'refunded', 'rejected'])
    .optional()
    .default('requested'),
  items: z.array(ReturnItemInputSchema).optional().default([]),
});

export const ReturnUpdateSchema = z.object({
  status: z
    .enum(['requested', 'approved', 'received', 'refunded', 'rejected'])
    .optional(),
  reason: z.string().trim().max(2000).optional().nullable(),
  refundAmount: moneyString.optional(),
});

export const ReturnListQuerySchema = z.object({
  shop_id: z.string().uuid().optional(),
  order_id: z.string().uuid().optional(),
  status: z
    .enum(['requested', 'approved', 'received', 'refunded', 'rejected'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
