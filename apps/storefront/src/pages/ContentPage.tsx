import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { CmsBlocks } from '../components/CmsBlocks';
import { ShopLink } from '../components/ShopLink';
import { Spinner, EmptyState, ErrorState } from '../components/States';

export function ContentPage() {
  const { slug = '' } = useParams();
  const pageQ = useAsync((signal) => api.getPage(slug, signal), [slug]);

  if (pageQ.loading) {
    return (
      <div className="container">
        <Spinner label="Pagina laden…" />
      </div>
    );
  }
  if (pageQ.error) {
    const notFound =
      pageQ.error instanceof ApiError && pageQ.error.status === 404;
    return (
      <div className="container">
        {notFound ? (
          <EmptyState
            title="Pagina niet gevonden"
            message="Deze pagina bestaat niet in deze shop."
            action={
              <ShopLink to="/" className="btn btn-primary">
                Naar home
              </ShopLink>
            }
          />
        ) : (
          <ErrorState onRetry={pageQ.reload} />
        )}
      </div>
    );
  }

  const page = pageQ.data!.page;
  return (
    <div className="container">
      <div className="breadcrumb">
        <ShopLink to="/">Home</ShopLink> / {page.title}
      </div>
      <h1>{page.title}</h1>
      <CmsBlocks blocks={page.blocks} />
    </div>
  );
}
