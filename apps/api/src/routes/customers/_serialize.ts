/**
 * Serializers — Drizzle-row → API-DTO (customers-module).
 *
 * Conventie (zie WAVE1-BACKEND-CONTRACT.md):
 *   - timestamp/Date → ISO-string
 *   - numeric (string in postgres-js) blijft string (Money)
 *   - jsonb/array-shapes stabiel houden
 */
import type { Customer, CustomerAddress } from '../../db/schema/index.js';
import type { Order } from '../../db/schema/index.js';

export interface CustomerDto {
  id: string;
  shopId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  company: string | null;
  vatNumber: string | null;
  acceptsMarketing: boolean;
  tags: string[];
  notes: string | null;
  ordersCount: number;
  totalSpent: string;
  createdAt: string;
  updatedAt: string;
}

export function toCustomerDto(c: Customer): CustomerDto {
  return {
    id: c.id,
    shopId: c.shopId,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    company: c.company,
    vatNumber: c.vatNumber,
    acceptsMarketing: c.acceptsMarketing,
    tags: c.tags,
    notes: c.notes,
    ordersCount: c.ordersCount,
    totalSpent: c.totalSpent,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export interface CustomerAddressDto {
  id: string;
  customerId: string;
  type: string;
  isDefault: boolean;
  name: string | null;
  line1: string | null;
  line2: string | null;
  postcode: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  phone: string | null;
  createdAt: string;
}

export function toCustomerAddressDto(a: CustomerAddress): CustomerAddressDto {
  return {
    id: a.id,
    customerId: a.customerId,
    type: a.type,
    isDefault: a.isDefault,
    name: a.name,
    line1: a.line1,
    line2: a.line2,
    postcode: a.postcode,
    city: a.city,
    province: a.province,
    country: a.country,
    phone: a.phone,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * Read-only order-historie-regel per klant. Subset van de orders-tabel — we
 * dupliceren de orders-routes NIET, dit is puur een select-projectie voor de
 * klant-detail-view.
 */
export interface CustomerOrderDto {
  id: string;
  orderNumber: string;
  channel: string;
  status: string;
  financialStatus: string;
  fulfillmentStatus: string;
  currency: string;
  grandTotal: string | null;
  placedAt: string | null;
  createdAt: string;
}

export function toCustomerOrderDto(o: Order): CustomerOrderDto {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    channel: o.channel,
    status: o.status,
    financialStatus: o.financialStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    currency: o.currency,
    grandTotal: o.grandTotal,
    placedAt: o.placedAt ? o.placedAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
  };
}
