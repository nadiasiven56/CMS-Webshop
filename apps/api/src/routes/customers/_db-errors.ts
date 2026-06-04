/**
 * Detectie van postgres-js fout-codes zodat routes nette HTTP-codes kunnen
 * teruggeven i.p.v. een generieke 500.
 *
 * postgres-js gooit een error met `.code` = de Postgres SQLSTATE
 * (https://www.postgresql.org/docs/current/errcodes-appendix.html).
 *   23505 = unique_violation
 *   23503 = foreign_key_violation
 */
function pgCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export function isUniqueViolation(err: unknown): boolean {
  return pgCode(err) === '23505';
}

export function isForeignKeyViolation(err: unknown): boolean {
  return pgCode(err) === '23503';
}
