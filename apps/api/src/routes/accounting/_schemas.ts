/**
 * Zod-validatieschemas voor de accounting-module (`/api/accounting`).
 *
 * Conventies (zie channels/_schemas.ts):
 *   - Credentials worden NOOIT in een response gezet; deze schemas valideren
 *     alleen het *inkomende* credential-body per provider. De route encrypteert
 *     ze direct via channel-crypto.
 *   - `config` is een vrij jsonb-blob (administrationId / division /
 *     ledgerMappings) — passthrough houdt provider-specifieke keys intact.
 */
import { z } from 'zod';

/** Boekhoud-providers waarvoor een adapter bestaat. */
export const ACCOUNTING_PROVIDERS = ['moneybird', 'exact', 'eboekhouden'] as const;
export const AccountingProviderSchema = z.enum(ACCOUNTING_PROVIDERS);

/** Statussen die een koppeling kan hebben. */
export const ACCOUNTING_STATUSES = ['disconnected', 'connected', 'error'] as const;
export const AccountingStatusSchema = z.enum(ACCOUNTING_STATUSES);

/**
 * Vrij config-blob. Bekende keys per provider:
 *   - moneybird  : administrationId
 *   - exact      : division
 *   - (allemaal) : ledgerMappings (account → extern grootboek-id)
 * Passthrough houdt extra keys intact.
 */
const configSchema = z
  .object({
    administrationId: z.string().trim().min(1).max(128).optional(),
    division: z.string().trim().min(1).max(128).optional(),
    ledgerMappings: z.record(z.string()).optional(),
  })
  .passthrough();

// ─── Create / Patch ──────────────────────────────────────────

export const ConnectionCreateSchema = z.object({
  provider: AccountingProviderSchema,
  name: z.string().trim().min(1).max(200),
  config: configSchema.optional(),
});

export const ConnectionPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    config: configSchema.optional(),
    status: AccountingStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one of name, config, status required',
  });

// ─── Credentials (per provider) ──────────────────────────────
//
// PUT /:id/credentials valideert per provider. De route kiest het juiste schema
// op basis van de opgeslagen connection.provider.

export const MoneybirdCredentialsSchema = z.object({
  accessToken: z.string().trim().min(1).max(4096),
});

export const ExactCredentialsSchema = z.object({
  accessToken: z.string().trim().min(1).max(4096),
  refreshToken: z.string().trim().min(1).max(4096),
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().trim().min(1).max(2048),
});

export const EBoekhoudenCredentialsSchema = z.object({
  username: z.string().trim().min(1).max(255),
  securityCode1: z.string().trim().min(1).max(512),
  securityCode2: z.string().trim().min(1).max(512),
});

/** Map provider → credentials-schema. */
export const CREDENTIALS_SCHEMA_BY_PROVIDER: Record<
  (typeof ACCOUNTING_PROVIDERS)[number],
  z.ZodTypeAny
> = {
  moneybird: MoneybirdCredentialsSchema,
  exact: ExactCredentialsSchema,
  eboekhouden: EBoekhoudenCredentialsSchema,
};

// ─── Sync ────────────────────────────────────────────────────

/**
 * Body voor POST /:id/sync. `scope` bepaalt of we facturen of orders pushen;
 * `from`/`to` (YYYY-MM-DD) bakenen de periode af (op de issue-/created-datum).
 */
export const SyncRequestSchema = z.object({
  scope: z.enum(['invoices', 'orders']).default('invoices'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// ─── List queries ────────────────────────────────────────────

export const ConnectionListQuerySchema = z.object({
  provider: AccountingProviderSchema.optional(),
  status: AccountingStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const SyncLogQuerySchema = z.object({
  status: z.enum(['pending', 'synced', 'error']).optional(),
  entityType: z.enum(['invoice', 'order', 'ledger_batch']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ConnectionCreateInput = z.infer<typeof ConnectionCreateSchema>;
export type ConnectionPatchInput = z.infer<typeof ConnectionPatchSchema>;
export type SyncRequestInput = z.infer<typeof SyncRequestSchema>;
