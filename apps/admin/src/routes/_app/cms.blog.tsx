/**
 * /cms/blog — blog-posts met editor.
 *
 * Shop-scoped (useActiveShop). Lijst + status-tabs + zoek; click-row opent een
 * edit-drawer met title/slug/excerpt/body_html/cover/tags/author/status/seo.
 * Backend: GET/POST/PATCH/DELETE /api/cms/blog.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Newspaper, Plus, Search, Trash2, X } from 'lucide-react';
import { useActiveShop } from '@/lib/shop-context';
import { formatRelative } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { ClickableRow } from '@/components/ui/ClickableRow';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  useBlogPosts,
  useCreateBlogPost,
  useUpdateBlogPost,
  useDeleteBlogPost,
  type BlogInput,
} from '@/components/cms/api';
import { SeoFieldset } from '@/components/cms/SeoFieldset';
import { BlogStatusPill, slugifyPreview } from '@/components/cms/pills';
import type { BlogPostDto, BlogStatus, SeoFields } from '@/components/cms/types';

export const Route = createFileRoute('/_app/cms/blog')({
  component: CmsBlogPage,
});

const STATUS_TABS = [
  { value: '', label: 'Alle' },
  { value: 'published', label: 'Gepubliceerd' },
  { value: 'draft', label: 'Concept' },
  { value: 'archived', label: 'Archief' },
] as const;

function CmsBlogPage() {
  const { activeShopId, activeShop } = useActiveShop();
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<BlogPostDto | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useBlogPosts(activeShopId, {
    status: status || undefined,
    search: search || undefined,
    limit: 100,
  });
  const items = query.data?.items ?? [];

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Blog</h1>
            <span className="count-badge">{query.data?.total ?? 0}</span>
          </div>
          <p className="page-subtitle">
            Artikelen & nieuws{activeShop ? ` voor ${activeShop.name}` : ''}.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setCreating(true)}
          disabled={!activeShopId}
        >
          <Plus size={15} strokeWidth={2.2} /> Nieuw artikel
        </button>
      </header>

      <div className="toolbar">
        <div className="search-input">
          <Search size={14} />
          <input
            aria-label="Zoek artikelen"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Zoek op titel…"
          />
        </div>
        <div className="segmented" role="tablist" aria-label="Status">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              data-active={status === tab.value}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {!activeShopId ? (
        <EmptyState icon={Newspaper} title="Geen shop geselecteerd" description="Kies eerst een shop bovenaan." />
      ) : query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">Kon artikelen niet laden. Probeer een refresh.</p>
        </div>
      ) : query.isLoading ? (
        <Skeleton height={320} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={search || status ? Search : Newspaper}
          title={search || status ? 'Geen artikelen gevonden' : 'Nog geen artikelen'}
          description={
            search || status
              ? 'Pas je zoekterm of filter aan.'
              : 'Schrijf je eerste blog-artikel.'
          }
          action={
            !search && !status ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> Nieuw artikel
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Titel</th>
                <th>Slug</th>
                <th>Tags</th>
                <th>Status</th>
                <th>Bijgewerkt</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <ClickableRow key={p.id} onActivate={() => setEditing(p)} ariaLabel={`Bewerk blogpost ${p.title}`}>
                  <td style={{ fontWeight: 600 }}>{p.title}</td>
                  <td className="mono muted">/{p.slug}</td>
                  <td className="muted">
                    {p.tags.length > 0 ? (
                      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                        {p.tags.slice(0, 3).map((t) => (
                          <span key={t} className="badge badge-neutral">
                            {t}
                          </span>
                        ))}
                        {p.tags.length > 3 && <span>+{p.tags.length - 3}</span>}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td><BlogStatusPill status={p.status} /></td>
                  <td className="muted">{formatRelative(p.updatedAt)}</td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BlogDrawer
        key={editing?.id ?? (creating ? 'new' : 'closed')}
        shopId={activeShopId}
        post={editing}
        creating={creating}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
function BlogDrawer({
  shopId,
  post,
  creating,
  onClose,
}: {
  shopId: string | null;
  post: BlogPostDto | null;
  creating: boolean;
  onClose: () => void;
}) {
  const open = creating || post != null;
  const isCreate = creating;

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [excerpt, setExcerpt] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [author, setAuthor] = useState('');
  const [status, setStatus] = useState<BlogStatus>('draft');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [seo, setSeo] = useState<SeoFields>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const create = useCreateBlogPost(shopId);
  const update = useUpdateBlogPost(shopId);
  const del = useDeleteBlogPost(shopId);

  useEffect(() => {
    if (!open) return;
    if (post) {
      setTitle(post.title);
      setSlug(post.slug);
      setSlugTouched(true);
      setExcerpt(post.excerpt ?? '');
      setBodyHtml(post.bodyHtml ?? '');
      setCoverImage(post.coverImage ?? '');
      setAuthor(post.author ?? '');
      setStatus(post.status);
      setTags(post.tags ?? []);
      setSeo(post.seo ?? {});
    } else {
      setTitle('');
      setSlug('');
      setSlugTouched(false);
      setExcerpt('');
      setBodyHtml('');
      setCoverImage('');
      setAuthor('');
      setStatus('draft');
      setTags([]);
      setSeo({});
    }
    setTagInput('');
    setConfirmDelete(false);
  }, [open, post]);

  const effectiveSlug = useMemo(
    () => (slugTouched ? slug : slugifyPreview(title)),
    [slug, slugTouched, title],
  );

  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Titel is verplicht');
      return;
    }
    const payload: BlogInput = {
      title: title.trim(),
      slug: effectiveSlug || undefined,
      excerpt: excerpt.trim() || null,
      bodyHtml: bodyHtml || null,
      coverImage: coverImage.trim() || null,
      author: author.trim() || null,
      status,
      tags,
      seo,
    };
    try {
      if (isCreate) {
        await create.mutateAsync(payload);
        toast.success(`Artikel '${title}' aangemaakt`);
      } else if (post) {
        await update.mutateAsync({ id: post.id, patch: payload });
        toast.success(`Artikel '${title}' opgeslagen`);
      }
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Opslaan mislukt'));
    }
  }

  async function onDelete() {
    if (!post) return;
    try {
      await del.mutateAsync(post.id);
      toast.success(`Artikel '${post.title}' verwijderd`);
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Verwijderen mislukt'));
    }
  }

  const busy = create.isPending || update.isPending;

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        width={600}
        title={isCreate ? 'Nieuw artikel' : post?.title}
        subtitle={isCreate ? 'Schrijf een blog-post.' : `/${post?.slug}`}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuleer
            </button>
            {!isCreate && post && (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} /> Verwijder
              </button>
            )}
            <button type="submit" form="blog-form" className="btn btn-primary" disabled={busy}>
              {isCreate ? 'Aanmaken' : 'Opslaan'}
            </button>
          </>
        }
      >
        <form id="blog-form" onSubmit={onSubmit}>
          <FormField label="Titel" required>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 8 }}>
            <FormField label="Slug">
              <input
                value={effectiveSlug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
                placeholder="auto uit titel"
              />
            </FormField>
            <FormField label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as BlogStatus)}>
                <option value="draft">Concept</option>
                <option value="published">Gepubliceerd</option>
                <option value="archived">Archief</option>
              </select>
            </FormField>
          </div>
          <FormField label="Samenvatting" hint="Korte intro voor overzichten.">
            <textarea
              rows={2}
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              style={{ resize: 'vertical', minHeight: 48, fontFamily: 'inherit' }}
            />
          </FormField>
          <FormField label="Inhoud (HTML)">
            <textarea
              rows={8}
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              style={{ resize: 'vertical', minHeight: 140, fontFamily: 'inherit' }}
            />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <FormField label="Cover-afbeelding (URL)">
              <input value={coverImage} onChange={(e) => setCoverImage(e.target.value)} placeholder="https://…" />
            </FormField>
            <FormField label="Auteur">
              <input value={author} onChange={(e) => setAuthor(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Tags">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: tags.length ? 6 : 0 }}>
              {tags.map((t) => (
                <span key={t} className="badge badge-neutral" style={{ gap: 4 }}>
                  {t}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                    className="icon-btn"
                    style={{ width: 16, height: 16 }}
                    aria-label={`Verwijder tag ${t}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
              placeholder="Type een tag en druk Enter"
            />
          </FormField>

          <SectionTitle>SEO</SectionTitle>
          <SeoFieldset value={seo} onChange={setSeo} titlePlaceholder={title} />
        </form>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDelete}
        title="Artikel verwijderen?"
        message={
          <>
            <strong>{post?.title}</strong> wordt permanent verwijderd.
          </>
        }
        confirmLabel="Verwijder"
      />
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 11,
        color: 'var(--theme-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        margin: '18px 0 8px',
      }}
    >
      {children}
    </h3>
  );
}

function errMsg(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string; error?: string } } };
  return e?.response?.data?.message ?? e?.response?.data?.error ?? fallback;
}
