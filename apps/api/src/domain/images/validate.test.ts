import { describe, it, expect } from 'vitest';
import { validateImageBuffer, statusForValidationError, MAX_IMAGE_BYTES } from './validate.js';

describe('validateImageBuffer', () => {
  it('accepts jpeg under cap', () => {
    const r = validateImageBuffer({ contentType: 'image/jpeg', size: 1234 });
    expect(r.ok).toBe(true);
  });

  it('rejects unsupported content-type', () => {
    const r = validateImageBuffer({ contentType: 'image/gif', size: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('unsupported_media_type');
      expect(statusForValidationError(r)).toBe(415);
    }
  });

  it('rejects empty file', () => {
    const r = validateImageBuffer({ contentType: 'image/png', size: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('empty_file');
      expect(statusForValidationError(r)).toBe(400);
    }
  });

  it('rejects > 10 MB', () => {
    const r = validateImageBuffer({ contentType: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('payload_too_large');
      expect(statusForValidationError(r)).toBe(413);
    }
  });

  it('exactly at cap is allowed', () => {
    const r = validateImageBuffer({ contentType: 'image/webp', size: MAX_IMAGE_BYTES });
    expect(r.ok).toBe(true);
  });
});
