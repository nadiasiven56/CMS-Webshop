/**
 * Rendert CMS-page-blocks. Bekende types: hero, richtext, product-grid.
 * Een product-grid-block haalt zelf producten op (source=published).
 * Onbekende types worden stil overgeslagen.
 */
import { useEffect, useState } from 'react';
import { ShopLink } from './ShopLink';
import { ProductCard } from './ProductCard';
import { api } from '../api/client';
import type { CmsPageBlock, ProductListItem } from '../api/types';

function HeroBlock({ block }: { block: CmsPageBlock }) {
  const heading = (block.heading as string) ?? '';
  const subheading = (block.subheading as string) ?? '';
  const cta = block.cta as { url?: string; label?: string } | undefined;
  return (
    <section className="hero">
      <h1>{heading}</h1>
      {subheading && <p>{subheading}</p>}
      {cta?.url && cta?.label && (
        <ShopLink to={cta.url} className="btn btn-lg">
          {cta.label}
        </ShopLink>
      )}
    </section>
  );
}

function RichtextBlock({ block }: { block: CmsPageBlock }) {
  const html = (block.html as string) ?? '';
  return (
    <section className="section">
      <div
        className="richtext"
        // CMS-content is door de shop-eigenaar beheerd (vertrouwd).
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}

function ProductGridBlock({ block }: { block: CmsPageBlock }) {
  const title = (block.title as string) ?? 'Uitgelicht';
  const limit = (block.limit as number) ?? 8;
  const [items, setItems] = useState<ProductListItem[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .listProducts({ limit, sort: 'position' }, ctrl.signal)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
    return () => ctrl.abort();
  }, [limit]);

  if (items && items.length === 0) return null;

  return (
    <section className="section">
      <div className="section__head">
        <h2>{title}</h2>
        <ShopLink to="/shop" className="btn-ghost">
          Bekijk alles →
        </ShopLink>
      </div>
      <div className="product-grid">
        {(items ?? []).map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

export function CmsBlock({ block }: { block: CmsPageBlock }) {
  switch (block.type) {
    case 'hero':
      return <HeroBlock block={block} />;
    case 'richtext':
      return <RichtextBlock block={block} />;
    case 'product-grid':
      return <ProductGridBlock block={block} />;
    default:
      return null;
  }
}

export function CmsBlocks({ blocks }: { blocks: CmsPageBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <CmsBlock key={i} block={b} />
      ))}
    </>
  );
}
