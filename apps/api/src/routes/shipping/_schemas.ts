/**
 * Zod-validatieschemas voor de shipping-module (`/api/shipping`).
 *
 * Conventies (zie channels/_schemas.ts):
 *   - Credentials worden NOOIT in een response gezet; deze schemas valideren
 *     alleen het *inkomende* credential-body per carrier-code. De route
 *     encrypteert ze direct via channel-crypto.
 *   - `config` is een vrij jsonb-blob (postnl bindt hierin environment).
 *   - Geld (rates) als decimal-STRING (numeric(12,4)).
 */
import { z } from 'zod';

/** Carrier-codes (4 geseed; adapter bestaat voor sendcloud/myparcel/postnl). */
export const CARRIER_CODES = ['sendcloud', 'myparcel', 'postnl', 'dhl'] as const;
export const CarrierCodeSchema = z.enum(CARRIER_CODES);

/** Statussen die een carrier kan hebben. */
export const CARRIER_STATUSES = ['disconnected', 'connected', 'error'] as const;
export const CarrierStatusSchema = z.enum(CARRIER_STATUSES);

/** Statussen die een shipment kan hebben. */
export const SHIPMENT_STATUSES = [
  'pending',
  'label_created',
  'in_transit',
  'delivered',
  'error',
] as const;
export const ShipmentStatusSchema = z.enum(SHIPMENT_STATUSES);

/** numeric(12,4)-string. Accepteert '12', '12.5', '12.5000', etc. */
const moneyString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,4})?$/, 'must be a decimal string with max 4 decimals');

/** Vrij config-blob — postnl gebruikt environment. Passthrough houdt extra
 *  carrier-specifieke keys intact. */
const configSchema = z
  .object({
    environment: z.enum(['sandbox', 'production']).optional(),
  })
  .passthrough();

// ─── Create / Patch ──────────────────────────────────────────

export const CarrierCreateSchema = z.object({
  code: CarrierCodeSchema,
  name: z.string().trim().min(1).max(200),
  config: configSchema.optional(),
});

export const CarrierPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    config: configSchema.optional(),
    status: CarrierStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one of name, config, status required',
  });

// ─── Credentials (per code) ──────────────────────────────────
//
// PUT /carriers/:id/credentials valideert per carrier-code. De route kiest het
// juiste schema op basis van de opgeslagen carrier.code.

export const SendcloudCredentialsSchema = z.object({
  publicKey: z.string().trim().min(1).max(512),
  secretKey: z.string().trim().min(1).max(2048),
});

export const MyParcelCredentialsSchema = z.object({
  apiKey: z.string().trim().min(1).max(2048),
});

export const PostNLCredentialsSchema = z.object({
  apiKey: z.string().trim().min(1).max(2048),
  customerCode: z.string().trim().min(1).max(64),
  customerNumber: z.string().trim().min(1).max(64),
});

/** Map carrier-code → credentials-schema. `dhl` heeft (nog) geen adapter/creds. */
export const CREDENTIALS_SCHEMA_BY_CODE: Record<
  (typeof CARRIER_CODES)[number],
  z.ZodTypeAny | null
> = {
  sendcloud: SendcloudCredentialsSchema,
  myparcel: MyParcelCredentialsSchema,
  postnl: PostNLCredentialsSchema,
  dhl: null,
};

// ─── Shipment create ─────────────────────────────────────────

const addressSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().max(200).optional().nullable(),
  street: z.string().trim().min(1).max(255),
  street2: z.string().trim().max(255).optional().nullable(),
  postalCode: z.string().trim().min(1).max(32),
  city: z.string().trim().min(1).max(128),
  province: z.string().trim().max(128).optional().nullable(),
  country: z.string().trim().length(2).toUpperCase(), // ISO-3166-1 alpha-2
  email: z.string().trim().email().max(255).optional().nullable(),
  phone: z.string().trim().max(64).optional().nullable(),
});

export const ShipmentCreateSchema = z.object({
  orderId: z.string().uuid(),
  carrierId: z.string().uuid(),
  weightGrams: z.coerce.number().int().min(1).max(1_000_000).optional(),
  service: z.string().trim().min(1).max(64).optional().nullable(),
  toAddress: addressSchema,
});

// ─── List query ──────────────────────────────────────────────

export const CarrierListQuerySchema = z.object({
  status: CarrierStatusSchema.optional(),
  code: CarrierCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const ShipmentListQuerySchema = z.object({
  order_id: z.string().uuid().optional(),
  status: ShipmentStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type CarrierCreateInput = z.infer<typeof CarrierCreateSchema>;
export type CarrierPatchInput = z.infer<typeof CarrierPatchSchema>;
export type ShipmentCreateInput = z.infer<typeof ShipmentCreateSchema>;

// Keep the money helper referenced so unused-import linters stay quiet when a
// future rates-endpoint validates quotes; exported for that wiring.
export const RateMoneySchema = moneyString;
