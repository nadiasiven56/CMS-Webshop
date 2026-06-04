/**
 * Serializers — admin Drizzle-rows → API-DTO's.
 *
 * SECURITY: users-DTO bevat NOOIT `passwordHash`; api-token-DTO bevat NOOIT
 * de raw token of `tokenHash` — alleen metadata. De raw token wordt alleen
 * 1x teruggegeven in de create-response (apart van deze serializer).
 */
import type { User } from '../../db/schema/users.js';
import type { ApiToken } from '../../db/schema/api-tokens.js';
import type { Webhook } from '../../db/schema/webhooks.js';

export interface UserDto {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export function toUserDto(u: User): UserDto {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
  };
}

export interface ApiTokenDto {
  id: string;
  label: string;
  scope: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export function toApiTokenDto(t: ApiToken): ApiTokenDto {
  return {
    id: t.id,
    label: t.label,
    scope: t.scope,
    lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  };
}

export interface WebhookDto {
  id: string;
  shopId: string | null;
  event: string;
  url: string;
  scope: string;
  /** Alleen of er een secret gezet is — nooit de waarde zelf. */
  hasSecret: boolean;
  active: boolean;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toWebhookDto(w: Webhook): WebhookDto {
  return {
    id: w.id,
    shopId: w.shopId ?? null,
    event: w.event,
    url: w.url,
    scope: w.scope,
    hasSecret: w.secret != null && w.secret.length > 0,
    active: w.active,
    lastFiredAt: w.lastFiredAt ? w.lastFiredAt.toISOString() : null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}
