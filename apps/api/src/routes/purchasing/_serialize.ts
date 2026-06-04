/**
 * Serializers — Drizzle-row → API-DTO voor purchasing-module.
 *
 * Conventie (Wave-1 backend-contract):
 *   - Date → ISO-string
 *   - numeric (string in pg-driver) blijft string (Money)
 *   - jsonb shape stabiel houden
 */
import type {
  Supplier,
  PurchaseOrder,
  PurchaseOrderItem,
} from '../../db/schema/index.js';

// ─── Supplier ────────────────────────────────────────────────

export interface SupplierDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: Supplier['address'];
  leadTimeDays: number;
  currency: string;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toSupplierDto(s: Supplier): SupplierDto {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone,
    address: s.address ?? null,
    leadTimeDays: s.leadTimeDays,
    currency: s.currency,
    notes: s.notes,
    active: s.active,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ─── Purchase-order item ─────────────────────────────────────

export interface PurchaseOrderItemDto {
  id: string;
  poId: string;
  variantId: string | null;
  sku: string | null;
  quantity: number;
  unitCost: string | null;
  quantityReceived: number;
  /** afgeleid: quantity - quantityReceived (>= 0). */
  quantityOutstanding: number;
  /** afgeleid: line subtotal = quantity * unitCost (string Money) of null. */
  lineTotal: string | null;
}

export function toPurchaseOrderItemDto(i: PurchaseOrderItem): PurchaseOrderItemDto {
  const outstanding = i.quantity - i.quantityReceived;
  return {
    id: i.id,
    poId: i.poId,
    variantId: i.variantId,
    sku: i.sku,
    quantity: i.quantity,
    unitCost: i.unitCost,
    quantityReceived: i.quantityReceived,
    quantityOutstanding: outstanding > 0 ? outstanding : 0,
    lineTotal: i.unitCost != null ? lineTotalOf(i.quantity, i.unitCost) : null,
  };
}

// ─── Purchase-order ──────────────────────────────────────────

export interface PurchaseOrderDto {
  id: string;
  supplierId: string;
  locationId: string | null;
  reference: string | null;
  status: string;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  expectedAt: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPurchaseOrderDto(po: PurchaseOrder): PurchaseOrderDto {
  return {
    id: po.id,
    supplierId: po.supplierId,
    locationId: po.locationId,
    reference: po.reference,
    status: po.status,
    currency: po.currency,
    subtotal: po.subtotal,
    taxTotal: po.taxTotal,
    total: po.total,
    expectedAt: po.expectedAt ? po.expectedAt.toISOString() : null,
    orderedAt: po.orderedAt ? po.orderedAt.toISOString() : null,
    receivedAt: po.receivedAt ? po.receivedAt.toISOString() : null,
    notes: po.notes,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
  };
}

export interface PurchaseOrderWithItemsDto extends PurchaseOrderDto {
  items: PurchaseOrderItemDto[];
}

export function toPurchaseOrderWithItems(
  po: PurchaseOrder,
  items: PurchaseOrderItem[],
): PurchaseOrderWithItemsDto {
  return {
    ...toPurchaseOrderDto(po),
    items: items.map(toPurchaseOrderItemDto),
  };
}

// ─── helper: line-total in hele centen (geen float-drift) ────

function lineTotalOf(quantity: number, unitCost: string): string {
  // unitCost is numeric(12,4) als string. Reken in 1/10000-eenheden.
  const units = Math.round(Number(unitCost) * 10_000);
  const total = units * quantity;
  return (total / 10_000).toFixed(4);
}
