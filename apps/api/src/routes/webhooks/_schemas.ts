/**
 * Zod-validatieschemas voor de webhooks-delivery-module (`/api/webhooks`).
 *
 * NB: dit is GEEN duplicaat van de webhook-CRUD (die woont in `/api/admin/webhooks`).
 * Hier alleen de delivery-log-queries + de test-fire-body.
 */
import { z } from 'zod';
import { WEBHOOK_EVENTS, type WebhookEvent } from '../../domain/webhooks/events.js';

// Cast to a writable tuple of the literal union so z.enum infers `WebhookEvent`
// (not `string`) for its output — keeps `input.event` typed as the union.
const WebhookEventSchema = z.enum(
  WEBHOOK_EVENTS as unknown as [WebhookEvent, ...WebhookEvent[]],
);

/** GET /deliveries — filter + paginate. */
export const DeliveryListQuerySchema = z.object({
  webhook_id: z.string().uuid().optional(),
  event: z.string().trim().min(1).max(128).optional(),
  success: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * POST /test-fire — vuur een sample-payload af. Twee vormen:
 *   - { webhookId }                          → laad de bestaande webhook en vuur.
 *   - { event, url, secret? }                → ad-hoc target zonder webhook-row.
 * `event` mag bij de webhookId-vorm meegegeven worden om het sample-event te
 * kiezen; anders defaulten we naar het `event` van de webhook (of order.created).
 */
export const TestFireSchema = z
  .object({
    webhookId: z.string().uuid().optional(),
    event: WebhookEventSchema.optional(),
    url: z.string().trim().url().max(2048).optional(),
    secret: z.string().trim().min(1).max(255).optional(),
    /** Optionele override van de sample-data; default een klein voorbeeld. */
    data: z.record(z.unknown()).optional(),
  })
  .refine((v) => v.webhookId !== undefined || v.url !== undefined, {
    message: 'either webhookId or url is required',
  })
  .refine((v) => v.webhookId !== undefined || v.event !== undefined, {
    message: 'event is required for an ad-hoc url target',
  });

export type DeliveryListQueryInput = z.infer<typeof DeliveryListQuerySchema>;
export type TestFireInput = z.infer<typeof TestFireSchema>;
