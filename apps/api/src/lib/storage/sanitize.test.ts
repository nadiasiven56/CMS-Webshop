import { describe, it, expect } from 'vitest';
import {
  sanitizeFilenameStem,
  makeImageKey,
  isAllowedMime,
  extensionForMime,
} from './sanitize.js';

describe('sanitizeFilenameStem', () => {
  it('lowercases + replaces special chars with dashes', () => {
    expect(sanitizeFilenameStem('Hello World!.png')).toBe('hello-world');
  });

  it('strips accents (NFKD)', () => {
    expect(sanitizeFilenameStem('Café résumé.jpg')).toBe('cafe-resume');
  });

  it('refuses path-traversal segments → reduces to plain stem', () => {
    expect(sanitizeFilenameStem('../../etc/passwd')).toBe('etc-passwd');
  });

  it('caps at 50 chars', () => {
    const long = 'a'.repeat(120) + '.png';
    expect(sanitizeFilenameStem(long).length).toBe(50);
  });

  it('handles edge cases (empty/whitespace/dots-only)', () => {
    expect(sanitizeFilenameStem('')).toBe('');
    expect(sanitizeFilenameStem('   ')).toBe('');
    expect(sanitizeFilenameStem('.png')).toBe('');
  });

  it('collapses multiple dashes', () => {
    expect(sanitizeFilenameStem('foo  ---  bar.png')).toBe('foo-bar');
  });
});

describe('isAllowedMime', () => {
  it('accepts jpeg/png/webp', () => {
    expect(isAllowedMime('image/jpeg')).toBe(true);
    expect(isAllowedMime('image/png')).toBe(true);
    expect(isAllowedMime('image/webp')).toBe(true);
  });

  it('rejects gif/svg/pdf/octet', () => {
    expect(isAllowedMime('image/gif')).toBe(false);
    expect(isAllowedMime('image/svg+xml')).toBe(false);
    expect(isAllowedMime('application/pdf')).toBe(false);
    expect(isAllowedMime('application/octet-stream')).toBe(false);
  });
});

describe('extensionForMime', () => {
  it('maps mime → file extension', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/webp')).toBe('webp');
  });
});

describe('makeImageKey', () => {
  it('builds canonical key with productId folder', () => {
    const key = makeImageKey({
      productId: '11111111-1111-1111-1111-111111111111',
      originalName: 'My Product Photo.jpg',
      uuid: '22222222-2222-2222-2222-222222222222',
      mime: 'image/jpeg',
    });
    expect(key).toBe(
      'images/products/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222-my-product-photo.jpg',
    );
  });

  it('falls back to loose/ folder when productId missing', () => {
    const key = makeImageKey({
      productId: null,
      originalName: 'thing.png',
      uuid: '33333333-3333-3333-3333-333333333333',
      mime: 'image/png',
    });
    expect(key.startsWith('images/loose/')).toBe(true);
    expect(key.endsWith('-thing.png')).toBe(true);
  });

  it('uses "image" stem if sanitized name empties', () => {
    const key = makeImageKey({
      productId: null,
      originalName: '   .jpg',
      uuid: '44444444-4444-4444-4444-444444444444',
      mime: 'image/jpeg',
    });
    expect(key.endsWith('-image.jpg')).toBe(true);
  });
});
