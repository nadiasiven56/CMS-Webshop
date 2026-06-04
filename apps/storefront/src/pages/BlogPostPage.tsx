import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { ShopLink } from '../components/ShopLink';
import { Spinner, EmptyState, ErrorState } from '../components/States';
import { formatDate } from '../lib/format';

export function BlogPostPage() {
  const { slug = '' } = useParams();
  const postQ = useAsync((signal) => api.getBlogPost(slug, signal), [slug]);

  if (postQ.loading) {
    return (
      <div className="container">
        <Spinner label="Artikel laden…" />
      </div>
    );
  }
  if (postQ.error) {
    const notFound =
      postQ.error instanceof ApiError && postQ.error.status === 404;
    return (
      <div className="container">
        {notFound ? (
          <EmptyState
            title="Artikel niet gevonden"
            action={
              <ShopLink to="/blog" className="btn btn-primary">
                Naar de blog
              </ShopLink>
            }
          />
        ) : (
          <ErrorState onRetry={postQ.reload} />
        )}
      </div>
    );
  }

  const post = postQ.data!;
  return (
    <div className="container">
      <article className="article">
        <div className="breadcrumb">
          <ShopLink to="/">Home</ShopLink> / <ShopLink to="/blog">Blog</ShopLink>{' '}
          / {post.title}
        </div>
        {post.coverImage && (
          <div className="article__cover">
            <img src={post.coverImage} alt={post.title} />
          </div>
        )}
        <h1>{post.title}</h1>
        <p className="blog-card__date">
          {post.author ? `${post.author} · ` : ''}
          {formatDate(post.publishedAt)}
        </p>
        {post.bodyHtml ? (
          <div
            className="richtext"
            dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
          />
        ) : post.excerpt ? (
          <p>{post.excerpt}</p>
        ) : null}

        {post.tags.length > 0 && (
          <div className="tag-row" style={{ marginTop: 28 }}>
            {post.tags.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}

        <ShopLink to="/blog" className="btn btn-outline" style={{ marginTop: 32 }}>
          ← Alle artikelen
        </ShopLink>
      </article>
    </div>
  );
}
