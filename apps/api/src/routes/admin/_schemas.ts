/**
 * Zod-validatieschemas voor de admin-module (/api/admin/*).
 *
 * Sub-modules: users, api-tokens, webhooks.
 */
import { z } from 'zod';

// ───────── Users ─────────

/** Toegestane rollen. Open-ended in DB (text), maar valideer een nette set. */
const roleSchema = z.enum(['admin', 'manager', 'viewer', 'disabled']);

export const UserCreateSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(200),
  role: roleSchema.optional(),
});

export const UserUpdateSchema = z
  .object({
    role: roleSchema.optional(),
    /** Convenience-flag: true → role='disabled', false → role='admin' (her-activeren). */
    disabled: z.boolean().optional(),
    password: z.string().min(8).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field required',
  });

export const UserListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  search: z.string().trim().min(1).optional(),
});

// ───────── API-tokens ─────────

const scopeSchema = z.string().trim().min(1).max(128);

export const ApiTokenCreateSchema = z.object({
  label: z.string().trim().min(1).max(200),
  scope: scopeSchema,
});

export const ApiTokenListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ───────── Webhooks ─────────

const webhookScopeSchema = z.enum(['order', 'channel', 'all']);

export const WebhookCreateSchema = z.object({
  event: z.string().trim().min(1).max(128), // 'order.created', 'channel.synced', ...
  url: z.string().trim().url().max(2048),
  scope: webhookScopeSchema,
  shopId: z.string().uuid().nullable().optional(),
  secret: z.string().trim().min(1).max(255).nullable().optional(),
  active: z.boolean().optional(),
});

export const WebhookUpdateSchema = z
  .object({
    event: z.string().trim().min(1).max(128).optional(),
    url: z.string().trim().url().max(2048).optional(),
    scope: webhookScopeSchema.optional(),
    shopId: z.string().uuid().nullable().optional(),
    secret: z.string().trim().min(1).max(255).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field required',
  });

export const WebhookListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  scope: webhookScopeSchema.optional(),
  active: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
});

export type UserCreateInput = z.infer<typeof UserCreateSchema>;
export type UserUpdateInput = z.infer<typeof UserUpdateSchema>;
export type ApiTokenCreateInput = z.infer<typeof ApiTokenCreateSchema>;
export type WebhookCreateInput = z.infer<typeof WebhookCreateSchema>;
export type WebhookUpdateInput = z.infer<typeof WebhookUpdateSchema>;
