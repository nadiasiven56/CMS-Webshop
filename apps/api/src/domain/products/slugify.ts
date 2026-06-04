/**
 * Slugify — title -> URL-safe slug.
 *
 * Pure deterministic helper:
 *   - lowercase
 *   - vervang accents (NFKD-normalisatie + diacritics-strip)
 *   - alleen [a-z0-9-]
 *   - trim leading/trailing dashes
 *   - collapsed multi-dashes naar 1 dash
 *
 * Tests: ./slugify.test.ts
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    // strip combining marks (accents)
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // ampersand naar 'and' (lokaal NL: 'en' kan ook, maar 'and' is internationaler)
    .replace(/&/g, ' and ')
    // alles wat geen alfanum is naar dash
    .replace(/[^a-z0-9]+/g, '-')
    // collapse multi-dashes
    .replace(/-+/g, '-')
    // trim leading/trailing dashes
    .replace(/^-+|-+$/g, '');
}
