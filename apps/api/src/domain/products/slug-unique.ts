/**
 * Slug-uniqueness helper.
 *
 * Postgres `products.slug` is unique. Bij duplicaat appendet deze helper
 * `-2`, `-3`, `-N` tot er een vrije slug is.
 *
 * Idempotent: zelfde title geeft binnen 1 transactie zelfde resultaat als
 * je dezelfde basis-slug aanlevert.
 *
 * IMPORTANT: roep deze helper aan binnen dezelfde transactie als de
 * uiteindelijke INSERT om race-conditions te voorkomen.
 */
import { eq, like, ne, and, or } from 'drizzle-orm';
import { products } from '../../db/schema/products.js';

/**
 * Drizzle-client shape die we nodig hebben (db OF transactie).
 * Bewust losjes getypeerd zodat zowel `db` als `tx`-handles werken zonder
 * Drizzle's interne PgTransaction-generic te exposeren.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlugClient = any;

export interface MakeUniqueSlugOptions {
  /** id van bestaand product (bij PATCH) — sluit zichzelf uit van uniqueness-check. */
  excludeId?: string;
  /** Max iteraties (defensive). Default 100. */
  maxIterations?: number;
}

export async function makeUniqueSlug(
  // Accepteert zowel db als tx (zelfde select-shape).
  client: SlugClient,
  baseSlug: string,
  options: MakeUniqueSlugOptions = {},
): Promise<string> {
  const { excludeId, maxIterations = 100 } = options;
  const safeBase = baseSlug || 'product';

  // Pak alle conflicterende slugs in 1 query: waar slug = safeBase OR slug LIKE 'safeBase-%'
  const rows = await client
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(
      excludeId
        ? and(
            ne(products.id, excludeId),
            or(eq(products.slug, safeBase), like(products.slug, `${safeBase}-%`)),
          )
        : or(eq(products.slug, safeBase), like(products.slug, `${safeBase}-%`)),
    );

  if (rows.length === 0) {
    return safeBase;
  }

  const taken = new Set(rows.map((r: { slug: string }) => r.slug));
  if (!taken.has(safeBase)) {
    return safeBase;
  }

  for (let i = 2; i <= maxIterations; i++) {
    const candidate = `${safeBase}-${i}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  // Defensive — practically unreachable
  throw new Error(`makeUniqueSlug: exhausted ${maxIterations} iterations for "${safeBase}"`);
}
