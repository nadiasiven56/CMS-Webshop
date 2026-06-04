import { describe, it, expect } from 'vitest';
import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lowercases and dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips accents', () => {
    expect(slugify('Café Olé')).toBe('cafe-ole');
    expect(slugify('crème brûlée')).toBe('creme-brulee');
  });

  it('replaces ampersand with and', () => {
    expect(slugify('Salt & Pepper')).toBe('salt-and-pepper');
  });

  it('collapses multiple dashes', () => {
    expect(slugify('foo  --  bar')).toBe('foo-bar');
  });

  it('trims edge dashes', () => {
    expect(slugify('  -hello-  ')).toBe('hello');
  });

  it('keeps digits', () => {
    expect(slugify('Coffee 100% Arabica')).toBe('coffee-100-arabica');
  });

  it('handles empty / whitespace', () => {
    expect(slugify('')).toBe('');
    expect(slugify('   ')).toBe('');
  });

  it('idempotent (same title = same slug)', () => {
    const a = slugify('My Coffee Maker');
    const b = slugify('My Coffee Maker');
    expect(a).toBe(b);
  });
});
