/**
 * Unit-tests voor de Clarity/Merchant-Center-uitbreiding van de feeds-module:
 *   - renderStorefrontTagsJs (domain/feeds/tags.ts) — pure generator
 *   - validateFeedItem      (domain/feeds/validate.ts) — pure per-item-check
 *   - toPublicAnalyticsDto  (routes/feeds/_serialize.ts) — clarity-mapping
 *
 * Allemaal pure functies → geen DB nodig (env wordt wel geladen via de import
 * van _serialize → build, vandaar dat .env aanwezig moet zijn).
 */
import { describe, it, expect } from 'vitest';
import { renderStorefrontTagsJs } from '../tags.js';
import { validateFeedItem } from '../validate.js';
import type { FeedItem } from '../types.js';
import { toPublicAnalyticsDto } from '../../../routes/feeds/_serialize.js';

// ─── helpers ────────────────────────────────────────────────────

function tagsInput(overrides: Partial<Parameters<typeof renderStorefrontTagsJs>[0]> = {}) {
  return {
    enabled: true,
    ga4MeasurementId: null,
    metaPixelId: null,
    googleAdsId: null,
    googleAdsConversionLabel: null,
    clarityProjectId: null,
    customHeadHtml: null,
    ...overrides,
  };
}

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'SKU-1',
    sku: 'SKU-1',
    title: 'Test product',
    description: 'Een nette omschrijving',
    link: 'https://shop.example/products/test',
    imageLink: 'https://shop.example/img/test.jpg',
    price: '19.9900',
    currency: 'EUR',
    availability: 'in_stock',
    condition: 'new',
    brand: 'Acme',
    gtin: '0001112223334',
    productType: 'Categorie',
    ...overrides,
  };
}

// ─── renderStorefrontTagsJs ─────────────────────────────────────

describe('renderStorefrontTagsJs', () => {
  it('disabled → no-op script, geen tags', () => {
    const js = renderStorefrontTagsJs(tagsInput({ enabled: false, clarityProjectId: 'abc' }));
    expect(js).not.toContain('clarity.ms');
    expect(js).not.toContain('gtag');
    expect(js).toContain('disabled');
  });

  it('enabled maar geen ids → no-op met hint', () => {
    const js = renderStorefrontTagsJs(tagsInput());
    expect(js).toContain('no tag ids');
    expect(js).not.toContain('clarity.ms');
  });

  it('Microsoft Clarity → laadt clarity.ms/tag met het project-id', () => {
    const js = renderStorefrontTagsJs(tagsInput({ clarityProjectId: 'abcd1234ef' }));
    expect(js).toContain('https://www.clarity.ms/tag/');
    expect(js).toContain('"abcd1234ef"');
    // alleen clarity → geen andere tags
    expect(js).not.toContain('gtag');
    expect(js).not.toContain('fbq');
  });

  it('GA4 → laadt gtag.js + config', () => {
    const js = renderStorefrontTagsJs(tagsInput({ ga4MeasurementId: 'G-XXXX' }));
    expect(js).toContain('googletagmanager.com/gtag/js');
    expect(js).toContain('gtag("config", "G-XXXX")');
  });

  it('Meta Pixel → fbq init + PageView', () => {
    const js = renderStorefrontTagsJs(tagsInput({ metaPixelId: '123456789012345' }));
    expect(js).toContain('fbq("init", "123456789012345")');
    expect(js).toContain('fbq("track", "PageView")');
  });

  it('Google Ads + label → conversie-helper shopTrackPurchase met send_to', () => {
    const js = renderStorefrontTagsJs(
      tagsInput({ googleAdsId: 'AW-123', googleAdsConversionLabel: 'lbl9' }),
    );
    expect(js).toContain('window.shopTrackPurchase');
    expect(js).toContain('"AW-123/lbl9"');
  });

  it('escapet waarden veilig (kan niet uit de JS-literal breken)', () => {
    const evil = 'x";})();alert(1);//';
    const js = renderStorefrontTagsJs(tagsInput({ clarityProjectId: evil }));
    // De waarde verschijnt alleen als veilige JSON-literal...
    expect(js).toContain(JSON.stringify(evil));
    // ...en de quote is geëscaped (\"), dus er is GEEN rauwe string-breakout `"x";`.
    expect(js).not.toContain('"x";');
  });

  it('alle tags samen → één script met alles', () => {
    const js = renderStorefrontTagsJs(
      tagsInput({
        ga4MeasurementId: 'G-1',
        googleAdsId: 'AW-1',
        metaPixelId: '999',
        clarityProjectId: 'cl1',
      }),
    );
    expect(js).toContain('gtag/js');
    expect(js).toContain('fbq("init", "999")');
    expect(js).toContain('clarity.ms/tag/');
  });
});

// ─── validateFeedItem ───────────────────────────────────────────

describe('validateFeedItem', () => {
  it('volledig item → geen errors, geen warnings', () => {
    const r = validateFeedItem(feedItem());
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('zonder afbeelding → error image_link', () => {
    const r = validateFeedItem(feedItem({ imageLink: '' }));
    expect(r.errors).toContain('image_link');
  });

  it('prijs 0 of niet-numeriek → error price', () => {
    expect(validateFeedItem(feedItem({ price: '0' })).errors).toContain('price');
    expect(validateFeedItem(feedItem({ price: '' })).errors).toContain('price');
    expect(validateFeedItem(feedItem({ price: 'gratis' })).errors).toContain('price');
  });

  it('lege titel/omschrijving/link → errors', () => {
    const r = validateFeedItem(feedItem({ title: '', description: '  ', link: '' }));
    expect(r.errors).toEqual(expect.arrayContaining(['title', 'description', 'link']));
  });

  it('geen merk én geen gtin → warning brand_or_gtin', () => {
    const r = validateFeedItem(feedItem({ brand: '', gtin: undefined }));
    expect(r.warnings).toContain('brand_or_gtin');
  });

  it('merk aanwezig (zonder gtin) → geen warning', () => {
    const r = validateFeedItem(feedItem({ brand: 'Acme', gtin: undefined }));
    expect(r.warnings).toHaveLength(0);
  });
});

// ─── toPublicAnalyticsDto — clarity-mapping ─────────────────────

describe('toPublicAnalyticsDto clarity', () => {
  const baseRow = {
    id: 'a',
    shopId: 's',
    ga4MeasurementId: null,
    metaPixelId: null,
    googleAdsId: null,
    googleAdsConversionLabel: null,
    clarityProjectId: 'clar-1',
    customHeadHtml: null,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('enabled → clarityProjectId in payload', () => {
    expect(toPublicAnalyticsDto(baseRow as never).clarityProjectId).toBe('clar-1');
  });

  it('disabled → clarityProjectId null', () => {
    expect(toPublicAnalyticsDto({ ...baseRow, enabled: false } as never).clarityProjectId).toBe(null);
  });

  it('null row → clarityProjectId null + enabled false', () => {
    const dto = toPublicAnalyticsDto(null);
    expect(dto.enabled).toBe(false);
    expect(dto.clarityProjectId).toBe(null);
  });
});
