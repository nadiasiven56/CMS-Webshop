/**
 * Zod-schemas + reken-helpers voor purchasing-module.
 *
 * Geld komt als string binnen (numeric(12,4) conventie). We valideren met een
 * regex i.p.v. z.number() zodat float-precisie nooit verloren gaat.
 */
import { z } from 'zod';

/** numeric(12,4)-compatibele money-string, bv "12", "12.5", "12.5000". */
export const MoneyStringSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,8}(\.\d{1,4})?$/, 'must be a numeric string with max 4 decimals');

export const PO_STATUSES = ['draft', 'ordered', 'partial', 'received', 'cancelled'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/**
 * Toegestane status-transities. `received`/`cancelled` zijn terminal.
 * `partial` wordt door de receive-actie gezet (niet handmatig via PATCH),
 * maar we staan het hier wel toe i.v.m. correcties.
 */
export const PO_TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  draft: ['ordered', 'cancelled'],
  ordered: ['partial', 'received', 'cancelled'],
  partial: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

// ─── Suppliers ───────────────────────────────────────────────

const SupplierAddressSchema = z
  .object({
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    postcode: z.string().trim().max(20).optional(),
    city: z.string().trim().max(120).optional(),
    province: z.string().trim().max(120).optional(),
    country: z.string().trim().length(2).optional(),
  })
  .strict();

export const SupplierCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  address: SupplierAddressSchema.optional().nullable(),
  leadTimeDays: z.coerce.number().int().min(0).max(365).optional(),
  currency: z.string().trim().length(3).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  active: z.boolean().optional(),
});

export const SupplierUpdateSchema = SupplierCreateSchema.partial();

export const SupplierListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  search: z.string().trim().min(1).optional(),
  active: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

// ─── Purchase orders ─────────────────────────────────────────

export const PoItemInputSchema = z.object({
  variantId: z.string().uuid().optional().nullable(),
  sku: z.string().trim().max(120).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  unitCost: MoneyStringSchema.optional().nullable(),
});

export const PurchaseOrderCreateSchema = z.object({
  supplierId: z.string().uuid(),
  locationId: z.string().uuid().optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  currency: z.string().trim().length(3).optional(),
  expectedAt: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** Optioneel BTW-percentage over subtotal (bv 21). Default 0. */
  taxRate: z.coerce.number().min(0).max(100).optional(),
  items: z.array(PoItemInputSchema).min(1).max(500),
});

export const PurchaseOrderUpdateSchema = z.object({
  locationId: z.string().uuid().optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  currency: z.string().trim().length(3).optional(),
  expectedAt: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(PO_STATUSES).optional(),
  /** Vervang ALLE items (alleen toegestaan zolang status === 'draft'). */
  items: z.array(PoItemInputSchema).min(1).max(500).optional(),
});

export const PurchaseOrderListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(PO_STATUSES).optional(),
  supplierId: z.string().uuid().optional(),
});

// ─── Receive ─────────────────────────────────────────────────

export const ReceiveSchema = z.object({
  /** locationId override; valt anders terug op po.location_id. */
  locationId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(1_000_000),
      }),
    )
    .min(1)
    .max(500),
});

// ─── Totals-berekening (hele 1/10000-eenheden, geen float-drift) ──

export interface PoTotals {
  subtotal: string;
  taxTotal: string;
  total: string;
}

/**
 * Bereken subtotal/tax/total uit items + taxRate (percentage).
 * Items zonder unitCost tellen als 0. Alles in numeric(12,4)-strings.
 */
export function computeTotals(
  items: Array<{ quantity: number; unitCost?: string | null }>,
  taxRate = 0,
): PoTotals {
  // subtotal in 1/10000-eenheden
  let subUnits = 0;
  for (const it of items) {
    if (it.unitCost == null) continue;
    const costUnits = Math.round(Number(it.unitCost) * 10_000);
    subUnits += costUnits * it.quantity;
  }
  // tax = round(subUnits * rate/100)
  const taxUnits = Math.round((subUnits * taxRate) / 100);
  const totalUnits = subUnits + taxUnits;
  return {
    subtotal: (subUnits / 10_000).toFixed(4),
    taxTotal: (taxUnits / 10_000).toFixed(4),
    total: (totalUnits / 10_000).toFixed(4),
  };
}
