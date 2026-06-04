/**
 * Zod-validatieschemas voor de reviews-module (`/api/reviews`).
 *
 * Conventies (zie channels/_schemas.ts + notifications/_schemas.ts):
 *   - Credentials worden NOOIT in een response gezet; deze schemas valideren
 *     alleen het *inkomende* credential-body per provider. De route encrypteert
 *     ze direct via channel-crypto.
 *   - `config` is een vrij jsonb-blob (locationId/businessUnitId/accountId) —
 *     passthrough houdt provider-specifieke keys intact.
 */
import { z } from 'zod';

/** Review-providers waarvoor een adapter bestaat. */
export const REVIEW_PROVIDERS = ['kiyoh', 'trustpilot', 'google'] as const;
export const ReviewProviderSchema = z.enum(REVIEW_PROVIDERS);

/** Statussen die een review-source kan hebben. */
export const REVIEW_SOURCE_STATUSES = ['disconnected', 'connected', 'error'] as const;
export const ReviewSourceStatusSchema = z.enum(REVIEW_SOURCE_STATUSES);

/**
 * Vrij config-blob voor een source. Bekende keys:
 *   - kiyoh      : locationId
 *   - trustpilot : businessUnitId
 *   - google     : accountId, locationId
 * Passthrough houdt provider-specifieke keys intact.
 */
const configSchema = z
  .object({
    locationId: z.string().trim().min(1).max(255).optional(),
    businessUnitId: z.string().trim().min(1).max(255).optional(),
    accountId: z.string().trim().min(1).max(255).optional(),
  })
  .passthrough();

// ─── Source create / patch ───────────────────────────────────

export const SourceCreateSchema = z.object({
  provider: ReviewProviderSchema,
  name: z.string().trim().min(1).max(200),
  config: configSchema.optional(),
});

export const SourcePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    config: configSchema.optional(),
    status: ReviewSourceStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one of name, config, status required',
  });

// ─── Credentials (per provider) ──────────────────────────────
//
// PUT /sources/:id/credentials valideert per provider. De route kiest het
// juiste schema op basis van de opgeslagen source.provider.

export const KiyohCredentialsSchema = z.object({
  apiHash: z.string().trim().min(1).max(2048),
});

export const TrustpilotCredentialsSchema = z.object({
  apiKey: z.string().trim().min(1).max(2048),
  apiSecret: z.string().trim().min(1).max(2048),
});

export const GoogleCredentialsSchema = z.object({
  accessToken: z.string().trim().min(1).max(8192),
});

/** Map provider → credentials-schema. */
export const CREDENTIALS_SCHEMA_BY_PROVIDER: Record<
  (typeof REVIEW_PROVIDERS)[number],
  z.ZodTypeAny
> = {
  kiyoh: KiyohCredentialsSchema,
  trustpilot: TrustpilotCredentialsSchema,
  google: GoogleCredentialsSchema,
};

// ─── Invite ──────────────────────────────────────────────────

/** Body voor POST /invite — queue een review-invitation voor een order. */
export const InviteSchema = z.object({
  email: z.string().trim().email().max(320),
  orderId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200).optional(),
});

// ─── List queries ────────────────────────────────────────────

export const SourceListQuerySchema = z.object({
  provider: ReviewProviderSchema.optional(),
  status: ReviewSourceStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const ReviewListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const SummaryQuerySchema = z.object({
  source_id: z.string().uuid().optional(),
});

export type SourceCreateInput = z.infer<typeof SourceCreateSchema>;
export type SourcePatchInput = z.infer<typeof SourcePatchSchema>;
export type InviteInput = z.infer<typeof InviteSchema>;
