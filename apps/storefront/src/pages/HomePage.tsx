import { api } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { CmsBlocks } from '../components/CmsBlocks';
import { ProductCard } from '../components/ProductCard';
import { ShopLink } from '../components/ShopLink';
import { Spinner, ErrorState } from '../components/States';
import { useShop } from '../state/ShopProvider';
import type { CmsPageBlock } from '../api/types';

export function HomePage() {
  const { shop } = useShop();

  // CMS-homepage (kan ontbreken → we vallen terug op een eigen hero).
  const homeQ = useAsync((signal) => api.getPage('home', signal), []);
  // Nieuwste producten als extra rij.
  const newestQ = useAsync(
    (signal) => api.listProducts({ limit: 4, sort: 'newest' }, signal),
    [],
  );

  if (homeQ.loading) {
    return (
      <div className="container">
        <Spinner label="Laden…" />
      </div>
    );
  }

  const blocks: CmsPageBlock[] = homeQ.data?.page.blocks ?? [];
  const hasCms = !homeQ.error && blocks.length > 0;

  return (
    <div className="container">
      {hasCms ? (
        <CmsBlocks blocks={blocks} />
      ) : (
        // Fallback-hero als er geen CMS-homepage is.
        <section className="hero">
          <h1>{shop?.name ?? 'Welkom'}</h1>
          <p>Ontdek ons assortiment, vers en met zorg samengesteld.</p>
          <ShopLink to="/shop" className="btn btn-lg">
            Shop nu
          </ShopLink>
        </section>
      )}

      <section className="section">
        <div className="section__head">
          <h2>Nieuw binnen</h2>
          <ShopLink to="/shop?sort=newest" className="btn-ghost">
            Meer →
          </ShopLink>
        </div>
        {newestQ.loading ? (
          <Spinner />
        ) : newestQ.error ? (
          <ErrorState onRetry={newestQ.reload} />
        ) : (
          <div className="product-grid">
            {(newestQ.data?.items ?? []).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
