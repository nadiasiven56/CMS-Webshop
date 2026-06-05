import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { ShopLink } from '../components/ShopLink';
import { Spinner, EmptyState, ErrorState } from '../components/States';
import { formatDate } from '../lib/format';
import { sanitizeHtml } from '../lib/sanitize';
import { useDocumentHead } from '../lib/useDocumentHead';
import { useShop } from '../state/ShopProvider';
import type { BlogPost } from '../api/types';

/** Lees een meta-description uit het seo-veld, val terug op excerpt/body. */
function seoString(seo: Record<string, unknown>, key: string): string | undefined {
  const v = seo?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function plainText(html: string | null | undefined, max = 160): string {
  if (!html) return '';
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function BlogPostSeo({ post, shopName }: { post: BlogPost; shopName: string }) {
  const description =
    seoString(post.seo, 'description') ||
    post.excerpt ||
    plainText(post.bodyHtml);
  const image =
    post.coverImage && /^https?:\/\//i.test(post.coverImage)
      ? post.coverImage
      : post.coverImage && typeof window !== 'undefined'
        ? new URL(post.coverImage, window.location.origin).href
        : undefined;

  const jsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      ...(image ? { image: [image] } : {}),
      ...(post.author ? { author: { '@type': 'Person', name: post.author } } : {}),
      ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
      ...(description ? { description } : {}),
      publisher: { '@type': 'Organization', name: shopName },
    }),
    [post.title, image, post.author, post.publishedAt, description, shopName],
  );

  useDocumentHead({
    title: `${seoString(post.seo, 'title') ?? post.title} — ${shopName}`,
    description,
    ogType: 'article',
    image,
    jsonLd,
  });
  return null;
}

export function BlogPostPage() {
  const { slug = '' } = useParams();
  const { shop } = useShop();
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
      <BlogPostSeo post={post} shopName={shop?.name ?? 'Webshop'} />
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
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.bodyHtml) }}
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
