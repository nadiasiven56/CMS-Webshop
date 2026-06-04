/**
 * Unit-test voor makeUniqueSlug — gebruikt een mock-DB met selectable rows.
 */
import { describe, it, expect } from 'vitest';
import { makeUniqueSlug } from './slug-unique.js';

function buildMockDb(existingSlugs: string[]) {
  return {
    select: () => ({
      from: () => ({
        where: async () =>
          existingSlugs.map((slug, i) => ({ id: `id-${i}`, slug })),
      }),
    }),
  } as never;
}

describe('makeUniqueSlug', () => {
  it('returns base when no conflicts', async () => {
    const db = buildMockDb([]);
    const slug = await makeUniqueSlug(db, 'cool-product');
    expect(slug).toBe('cool-product');
  });

  it('returns base when only similar prefixed slugs exist (no exact match)', async () => {
    const db = buildMockDb(['cool-product-x']); // not exact base
    const slug = await makeUniqueSlug(db, 'cool-product');
    expect(slug).toBe('cool-product');
  });

  it('appends -2 on first collision', async () => {
    const db = buildMockDb(['cool-product']);
    const slug = await makeUniqueSlug(db, 'cool-product');
    expect(slug).toBe('cool-product-2');
  });

  it('appends -3 when -2 also taken', async () => {
    const db = buildMockDb(['cool-product', 'cool-product-2']);
    const slug = await makeUniqueSlug(db, 'cool-product');
    expect(slug).toBe('cool-product-3');
  });

  it('falls back to "product" on empty base', async () => {
    const db = buildMockDb([]);
    const slug = await makeUniqueSlug(db, '');
    expect(slug).toBe('product');
  });
});
