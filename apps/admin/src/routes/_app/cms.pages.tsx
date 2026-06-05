/**
 * /cms/pages — CMS-pagina's met page-builder.
 *
 * Shop-scoped (useActiveShop). Lijst met status-tabs + zoek; click-row opent
 * een edit-drawer met:
 *   - titel/slug/status
 *   - block-builder (hero/richtext/banner/product-grid/html, content = jsonb)
 *   - SEO-velden (title/description/ogImage/noindex)
 * Backend: GET/POST/PATCH/DELETE /api/cms/pages.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FileText, Plus, Search, Trash2 } from 'lucide-react';
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
  usePages,
  useCreatePage,
  useUpdatePage,
  useDeletePage,
  type PageInput,
} from '@/components/cms/api';
import { BlockBuilder } from '@/components/cms/BlockBuilder';
import { SeoFieldset } from '@/components/cms/SeoFieldset';
import { PageStatusPill, slugifyPreview } from '@/components/cms/pills';
import type { CmsPageDto, PageBlock, PageStatus, SeoFields } from '@/components/cms/types';

export const Route = createFileRoute('/_app/cms/pages')({
  component: CmsPagesPage,
});

const STATUS_TABS = [
  { value: '', label: 'Alle' },
  { value: 'published', label: 'Gepubliceerd' },
  { value: 'draft', label: 'Concept' },
] as const;

function CmsPagesPage() {
  const { activeShopId, activeShop } = useActiveShop();
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CmsPageDto | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = usePages(activeShopId, {
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
            <h1 className="page-title">Pagina's</h1>
            <span className="count-badge">{query.data?.total ?? 0}</span>
          </div>
          <p className="page-subtitle">
            Bouw landingspagina's met blocks{activeShop ? ` voor ${activeShop.name}` : ''}.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setCreating(true)}
          disabled={!activeShopId}
        >
          <Plus size={15} strokeWidth={2.2} /> Nieuwe pagina
        </button>
      </header>

      <div className="toolbar">
        <div className="search-input">
          <Search size={14} />
          <input
            aria-label="Zoek pagina's"
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
        <EmptyState icon={FileText} title="Geen shop geselecteerd" description="Kies eerst een shop bovenaan." />
      ) : query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">Kon pagina's niet laden. Probeer een refresh.</p>
        </div>
      ) : query.isLoading ? (
        <Skeleton height={320} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={search || status ? Search : FileText}
          title={search || status ? "Geen pagina's gevonden" : "Nog geen pagina's"}
          description={
            search || status
              ? 'Pas je zoekterm of filter aan.'
              : 'Maak je eerste pagina met de page-builder.'
          }
          action={
            !search && !status ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> Nieuwe pagina
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
                <th>Blocks</th>
                <th>Status</th>
                <th>Bijgewerkt</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <ClickableRow
                  key={p.id}
                  onActivate={() => setEditing(p)}
                  ariaLabel={`Bewerk pagina ${p.title}`}
                >
                  <td style={{ fontWeight: 600 }}>{p.title}</td>
                  <td className="mono muted">/{p.slug}</td>
                  <td className="muted">{p.blocks.length}</td>
                  <td><PageStatusPill status={p.status} /></td>
                  <td className="muted">{formatRelative(p.updatedAt)}</td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PageDrawer
        key={editing?.id ?? (creating ? 'new' : 'closed')}
        shopId={activeShopId}
        page={editing}
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
function blocksFromDto(raw: unknown[]): PageBlock[] {
  return raw.map((b, i) => {
    const obj = (b ?? {}) as Record<string, unknown>;
    return {
      id:
        typeof obj.id === 'string'
          ? obj.id
          : `blk-${i}-${Math.random().toString(36).slice(2)}`,
      type: (typeof obj.type === 'string' ? obj.type : 'richtext') as PageBlock['type'],
      data: (obj.data && typeof obj.data === 'object'
        ? (obj.data as Record<string, unknown>)
        : {}) as Record<string, unknown>,
    };
  });
}

function PageDrawer({
  shopId,
  page,
  creating,
  onClose,
}: {
  shopId: string | null;
  page: CmsPageDto | null;
  creating: boolean;
  onClose: () => void;
}) {
  const open = creating || page != null;
  const isCreate = creating;

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [status, setStatus] = useState<PageStatus>('draft');
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [seo, setSeo] = useState<SeoFields>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const create = useCreatePage(shopId);
  const update = useUpdatePage(shopId);
  const del = useDeletePage(shopId);

  useEffect(() => {
    if (!open) return;
    if (page) {
      setTitle(page.title);
      setSlug(page.slug);
      setSlugTouched(true);
      setStatus(page.status);
      setBlocks(blocksFromDto(page.blocks));
      setSeo(page.seo ?? {});
    } else {
      setTitle('');
      setSlug('');
      setSlugTouched(false);
      setStatus('draft');
      setBlocks([]);
      setSeo({});
    }
    setConfirmDelete(false);
  }, [open, page]);

  const effectiveSlug = useMemo(
    () => (slugTouched ? slug : slugifyPreview(title)),
    [slug, slugTouched, title],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Titel is verplicht');
      return;
    }
    const payload: PageInput = {
      title: title.trim(),
      slug: effectiveSlug || undefined,
      status,
      blocks,
      seo,
    };
    try {
      if (isCreate) {
        await create.mutateAsync(payload);
        toast.success(`Pagina '${title}' aangemaakt`);
      } else if (page) {
        await update.mutateAsync({ id: page.id, patch: payload });
        toast.success(`Pagina '${title}' opgeslagen`);
      }
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Opslaan mislukt'));
    }
  }

  async function onDelete() {
    if (!page) return;
    try {
      await del.mutateAsync(page.id);
      toast.success(`Pagina '${page.title}' verwijderd`);
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
        title={isCreate ? 'Nieuwe pagina' : page?.title}
        subtitle={isCreate ? 'Bouw met blocks.' : `/${page?.slug}`}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuleer
            </button>
            {!isCreate && page && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} /> Verwijder
              </button>
            )}
            <button type="submit" form="page-form" className="btn btn-primary" disabled={busy}>
              {isCreate ? 'Aanmaken' : 'Opslaan'}
            </button>
          </>
        }
      >
        <form id="page-form" onSubmit={onSubmit}>
          <FormField label="Titel" required>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 8 }}>
            <FormField label="Slug" hint="URL-pad binnen de shop.">
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
              <select value={status} onChange={(e) => setStatus(e.target.value as PageStatus)}>
                <option value="draft">Concept</option>
                <option value="published">Gepubliceerd</option>
              </select>
            </FormField>
          </div>

          <SectionTitle>Blocks</SectionTitle>
          <BlockBuilder value={blocks} onChange={setBlocks} />

          <SectionTitle>SEO</SectionTitle>
          <SeoFieldset value={seo} onChange={setSeo} titlePlaceholder={title} />
        </form>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDelete}
        title="Pagina verwijderen?"
        message={
          <>
            <strong>{page?.title}</strong> wordt permanent verwijderd.
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
