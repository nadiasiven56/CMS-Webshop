/**
 * Serializers — webhook-delivery Drizzle-rows → API-DTO's.
 *
 * De list-DTO is compact (zonder de volle payload/response-body) zodat de log
 * snel te scrollen is; het detail-endpoint geeft alles terug.
 */
import type { WebhookDelivery } from '../../db/schema/webhook-deliveries.js';

export interface WebhookDeliveryListDto {
  id: string;
  webhookId: string | null;
  event: string;
  url: string;
  success: boolean;
  responseStatus: number | null;
  attempt: number;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export function toDeliveryListDto(d: WebhookDelivery): WebhookDeliveryListDto {
  return {
    id: d.id,
    webhookId: d.webhookId ?? null,
    event: d.event,
    url: d.url,
    success: d.success,
    responseStatus: d.responseStatus ?? null,
    attempt: d.attempt,
    durationMs: d.durationMs ?? null,
    errorMessage: d.errorMessage ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

export interface WebhookDeliveryDetailDto extends WebhookDeliveryListDto {
  payload: Record<string, unknown> | null;
  requestHeaders: Record<string, string> | null;
  responseBody: string | null;
}

export function toDeliveryDetailDto(d: WebhookDelivery): WebhookDeliveryDetailDto {
  return {
    ...toDeliveryListDto(d),
    payload: d.payload ?? null,
    requestHeaders: d.requestHeaders ?? null,
    responseBody: d.responseBody ?? null,
  };
}
