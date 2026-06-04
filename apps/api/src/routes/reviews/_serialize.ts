/**
 * Serializers — Drizzle-row → API-DTO voor de reviews-module.
 *
 * KRITISCH: credentials worden NOOIT raw teruggegeven. We tonen alleen een
 * presence-map via {@link maskCredentials} (`{ apiHash: 'set' | null, ... }`),
 * zodat de UI kan zien WELKE velden ingevuld zijn zonder de geheimen te lekken.
 *
 * Conventie (zie channels/_serialize.ts + notifications/_serialize.ts):
 *   - timestamps → ISO-string
 *   - numeric (ratingAverage) blijft string of null (nooit silently floaten)
 *   - jsonb (config) shape stabiel houden
 */
import type {
  ReviewSource,
  Review,
  ReviewInvitation,
} from '../../db/schema/reviews.js';
import { decryptCredentials, maskCredentials } from '../../lib/channel-crypto.js';

export interface ReviewSourceDto {
  id: string;
  provider: string;
  name: string;
  status: string;
  /** Presence-map per credential-veld — NOOIT de raw waarde. */
  credentials: Record<string, 'set' | null>;
  /** True als er ueberhaupt versleutelde credentials zijn opgeslagen. */
  hasCredentials: boolean;
  config: Record<string, unknown>;
  /** numeric(3,2) → string (of null) om float-precisie nooit te verliezen. */
  ratingAverage: string | null;
  ratingCount: number;
  lastFetchAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Decrypt-in-memory → mask. De decrypted waarden verlaten deze functie NOOIT;
 * we geven enkel de presence-map terug. Bij niet-ontsleutelbare/lege creds is de
 * map leeg ({}).
 */
function maskedCreds(source: ReviewSource): Record<string, 'set' | null> {
  const decrypted = decryptCredentials(
    (source.credentials ?? null) as { enc: string } | null,
  );
  return maskCredentials(decrypted);
}

export function toSourceDto(s: ReviewSource): ReviewSourceDto {
  return {
    id: s.id,
    provider: s.provider,
    name: s.name,
    status: s.status,
    credentials: maskedCreds(s),
    hasCredentials: s.credentials != null,
    config: (s.config ?? {}) as Record<string, unknown>,
    ratingAverage: s.ratingAverage ?? null,
    ratingCount: s.ratingCount,
    lastFetchAt: s.lastFetchAt ? s.lastFetchAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ─── reviews ─────────────────────────────────────────────────

export interface ReviewDto {
  id: string;
  sourceId: string;
  externalId: string | null;
  provider: string | null;
  rating: number | null;
  title: string | null;
  body: string | null;
  authorName: string | null;
  productId: string | null;
  orderId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toReviewDto(r: Review): ReviewDto {
  return {
    id: r.id,
    sourceId: r.sourceId,
    externalId: r.externalId,
    provider: r.provider,
    rating: r.rating,
    title: r.title,
    body: r.body,
    authorName: r.authorName,
    productId: r.productId,
    orderId: r.orderId,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── review_invitations ──────────────────────────────────────

export interface ReviewInvitationDto {
  id: string;
  sourceId: string | null;
  orderId: string | null;
  email: string | null;
  status: string;
  provider: string | null;
  error: string | null;
  createdAt: string;
}

export function toInvitationDto(i: ReviewInvitation): ReviewInvitationDto {
  return {
    id: i.id,
    sourceId: i.sourceId,
    orderId: i.orderId,
    email: i.email,
    status: i.status,
    provider: i.provider,
    error: i.error,
    createdAt: i.createdAt.toISOString(),
  };
}
