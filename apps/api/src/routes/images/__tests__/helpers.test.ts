import { describe, it, expect } from 'vitest';
import { _deriveKeyFromUrl } from '../index.js';

describe('deriveKeyFromUrl', () => {
  it('extracts key from local-driver URL', () => {
    expect(
      _deriveKeyFromUrl('http://localhost:7300/storage/images/products/p1/abc-x.jpg'),
    ).toBe('images/products/p1/abc-x.jpg');
  });

  it('returns null for URL without /storage/ marker', () => {
    expect(_deriveKeyFromUrl('https://cdn.example.com/foo/bar.jpg')).toBe(null);
  });

  it('handles URL with custom domain', () => {
    expect(
      _deriveKeyFromUrl('https://shop.example.com/storage/images/loose/file.png'),
    ).toBe('images/loose/file.png');
  });
});
