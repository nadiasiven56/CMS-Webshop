/**
 * Mini-pills + helpers voor de CMS-module.
 * Hergebruikt de bestaande `badge`-CSS-classes (geen nieuwe stijl).
 */
import type { BlockType, BlogStatus, PageStatus } from './types';

const PAGE_STATUS: Record<PageStatus, { label: string; klass: string }> = {
  draft: { label: 'Concept', klass: 'badge-neutral' },
  published: { label: 'Gepubliceerd', klass: 'badge-success' },
};

const BLOG_STATUS: Record<BlogStatus, { label: string; klass: string }> = {
  draft: { label: 'Concept', klass: 'badge-neutral' },
  published: { label: 'Gepubliceerd', klass: 'badge-success' },
  archived: { label: 'Archief', klass: 'badge-warning' },
};

export function PageStatusPill({ status }: { status: PageStatus }) {
  const m = PAGE_STATUS[status] ?? { label: status, klass: 'badge-neutral' };
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}

export function BlogStatusPill({ status }: { status: BlogStatus }) {
  const m = BLOG_STATUS[status] ?? { label: status, klass: 'badge-neutral' };
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}

export const BLOCK_META: Record<BlockType, { label: string; emoji: string; hint: string }> = {
  hero: { label: 'Hero', emoji: '🦸', hint: 'Grote kop + subtitel + CTA' },
  richtext: { label: 'Tekst', emoji: '📝', hint: 'Vrije HTML-tekst' },
  banner: { label: 'Banner', emoji: '📢', hint: 'Aankondiging / promo-strook' },
  'product-grid': { label: 'Productgrid', emoji: '🛍️', hint: 'Selectie van producten' },
  html: { label: 'Raw HTML', emoji: '</>', hint: 'Eigen HTML-snippet' },
};

export function BlockTypePill({ type }: { type: BlockType }) {
  const m = BLOCK_META[type] ?? { label: type, emoji: '▫️' };
  return (
    <span className="badge badge-neutral" style={{ gap: 5 }}>
      <span aria-hidden="true">{m.emoji}</span>
      {m.label}
    </span>
  );
}

/** Lokale slug-afgeleide (server doet de canonieke slugify; dit is alleen preview). */
export function slugifyPreview(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
