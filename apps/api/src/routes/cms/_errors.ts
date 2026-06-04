/**
 * Gedeelde error-helpers voor de CMS-routes.
 */
import type { Context } from 'hono';

/** postgres-js unique-violation. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

/** postgres-js foreign-key-violation. */
export function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23503'
  );
}

/** 400 met zod-flatten details. */
export function invalid(c: Context, details: unknown): Response {
  return c.json({ error: 'invalid_request', details }, 400);
}

/** 400 als geen geldige shop is meegegeven; 404 als de shop niet bestaat. */
export function shopError(c: Context, provided: boolean): Response {
  if (!provided) {
    return c.json(
      {
        error: 'shop_required',
        message: 'Geef ?shop=<slug|id> of X-Shop-Id header mee.',
      },
      400,
    );
  }
  return c.json({ error: 'shop_not_found', message: 'Onbekende shop.' }, 404);
}
