/**
 * Zod-validatieschemas voor de notifications/email-module (`/api/notifications`).
 *
 * Conventies (zie channels/_schemas.ts + accounting/_schemas.ts):
 *   - Credentials worden NOOIT in een response gezet; deze schemas valideren
 *     alleen het *inkomende* credential-body per provider. De route encrypteert
 *     ze direct via channel-crypto.
 *   - `config` is een vrij jsonb-blob (fromEmail/fromName/replyTo/mailgunDomain/
 *     smtpHost/smtpPort/smtpSecure) — passthrough houdt extra keys intact.
 */
import { z } from 'zod';

/** Email-providers waarvoor een adapter bestaat. */
export const EMAIL_PROVIDERS = ['smtp', 'postmark', 'sendgrid', 'mailgun'] as const;
export const EmailProviderSchema = z.enum(EMAIL_PROVIDERS);

/** Statussen die een provider-config kan hebben. */
export const EMAIL_PROVIDER_STATUSES = ['disconnected', 'connected', 'error'] as const;
export const EmailProviderStatusSchema = z.enum(EMAIL_PROVIDER_STATUSES);

/** Template-keys die we standaard kennen (vrij uitbreidbaar — `key` is text). */
export const EMAIL_TEMPLATE_KEYS = [
  'order_confirmation',
  'order_shipped',
  'order_refunded',
  'return_received',
  'welcome',
] as const;

/**
 * Vrij config-blob voor een provider. Bekende keys:
 *   - (allemaal) : fromEmail, fromName, replyTo
 *   - mailgun    : mailgunDomain
 *   - smtp       : smtpHost, smtpPort, smtpSecure
 * Passthrough houdt provider-specifieke keys intact.
 */
const providerConfigSchema = z
  .object({
    fromEmail: z.string().trim().email().max(320).optional(),
    fromName: z.string().trim().min(1).max(200).optional(),
    replyTo: z.string().trim().email().max(320).optional(),
    mailgunDomain: z.string().trim().min(1).max(255).optional(),
    smtpHost: z.string().trim().min(1).max(255).optional(),
    smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
    smtpSecure: z.boolean().optional(),
  })
  .passthrough();

// ─── Provider create / patch ─────────────────────────────────

export const ProviderConfigCreateSchema = z.object({
  provider: EmailProviderSchema,
  name: z.string().trim().min(1).max(200),
  config: providerConfigSchema.optional(),
});

export const ProviderConfigPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    config: providerConfigSchema.optional(),
    status: EmailProviderStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one of name, config, status required',
  });

// ─── Credentials (per provider) ──────────────────────────────
//
// PUT /providers/:id/credentials valideert per provider. De route kiest het
// juiste schema op basis van de opgeslagen provider.

export const PostmarkCredentialsSchema = z.object({
  serverToken: z.string().trim().min(1).max(2048),
});

export const SendGridCredentialsSchema = z.object({
  apiKey: z.string().trim().min(1).max(2048),
});

export const MailgunCredentialsSchema = z.object({
  apiKey: z.string().trim().min(1).max(2048),
});

export const SmtpCredentialsSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  user: z.string().trim().min(1).max(255),
  pass: z.string().trim().min(1).max(1024),
  secure: z.boolean().default(false),
});

/** Map provider → credentials-schema. */
export const CREDENTIALS_SCHEMA_BY_PROVIDER: Record<
  (typeof EMAIL_PROVIDERS)[number],
  z.ZodTypeAny
> = {
  smtp: SmtpCredentialsSchema,
  postmark: PostmarkCredentialsSchema,
  sendgrid: SendGridCredentialsSchema,
  mailgun: MailgunCredentialsSchema,
};

// ─── Templates ───────────────────────────────────────────────

export const TemplateCreateSchema = z.object({
  key: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().min(1).max(500),
  bodyHtml: z.string().min(1),
  bodyText: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  locale: z.string().trim().min(2).max(10).optional(),
});

export const TemplatePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    subject: z.string().trim().min(1).max(500).optional(),
    bodyHtml: z.string().min(1).optional(),
    bodyText: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    locale: z.string().trim().min(2).max(10).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one editable field required',
  });

// ─── Test send ───────────────────────────────────────────────

/** Body voor POST /test-send — verstuur een sample-mail via een template. */
export const TestSendSchema = z.object({
  to: z.string().trim().email().max(320),
  templateKey: z.string().trim().min(1).max(128).default('welcome'),
});

/** Body voor POST /providers/:id/test-connection (geen velden nodig). */
export const TestEmailSchema = z.object({
  to: z.string().trim().email().max(320).optional(),
});

// ─── List queries ────────────────────────────────────────────

export const ProviderListQuerySchema = z.object({
  provider: EmailProviderSchema.optional(),
  status: EmailProviderStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const EmailLogQuerySchema = z.object({
  to: z.string().trim().max(320).optional(),
  order_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ProviderConfigCreateInput = z.infer<typeof ProviderConfigCreateSchema>;
export type ProviderConfigPatchInput = z.infer<typeof ProviderConfigPatchSchema>;
export type TemplateCreateInput = z.infer<typeof TemplateCreateSchema>;
export type TemplatePatchInput = z.infer<typeof TemplatePatchSchema>;
export type TestSendInput = z.infer<typeof TestSendSchema>;
