import { api } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { ShopLink } from '../components/ShopLink';
import { EmptyState, ErrorState, Spinner } from '../components/States';
import { formatDate } from '../lib/format';

export function BlogListPage() {
  const blogQ = useAsync((signal) => api.listBlog({ limit: 24 }, signal), []);

  return (
    <div className="container">
      <h1 style={{ marginTop: 28 }}>Blog</h1>
      <p className="product-card__vendor" style={{ marginBottom: 24 }}>
        Verhalen, tips en nieuws
      </p>

      {blogQ.loading ? (
        <Spinner />
      ) : blogQ.error ? (
        <ErrorState onRetry={blogQ.reload} />
      ) : (blogQ.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="Nog geen artikelen"
          message="Kom snel terug voor nieuwe blogposts."
        />
      ) : (
        <div className="blog-grid" style={{ marginBottom: 48 }}>
          {blogQ.data!.items.map((post) => (
            <ShopLink
              to={`/blog/${post.slug}`}
              className="blog-card"
              key={post.slug}
            >
              <div className="blog-card__cover">
                {post.coverImage ? (
                  <img src={post.coverImage} alt={post.title} loading="lazy" />
                ) : null}
              </div>
              <div className="blog-card__body">
                {post.publishedAt && (
                  <span className="blog-card__date">
                    {formatDate(post.publishedAt)}
                  </span>
                )}
                <h3 style={{ margin: 0 }}>{post.title}</h3>
                {post.excerpt && (
                  <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                    {post.excerpt}
                  </p>
                )}
                {post.tags.length > 0 && (
                  <div className="tag-row" style={{ marginTop: 'auto' }}>
                    {post.tags.map((t) => (
                      <span className="tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </ShopLink>
          ))}
        </div>
      )}
    </div>
  );
}
