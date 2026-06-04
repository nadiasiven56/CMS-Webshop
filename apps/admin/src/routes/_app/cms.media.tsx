/**
 * /cms/media — media-library grid.
 *
 * Shop-scoped (useActiveShop, scope=all → shop-eigen + globaal). Upload via
 * MediaUploader (POST /api/cms/media multipart). Click-tegel opent een
 * edit-drawer (alt/folder bewerken) met delete als secundaire actie.
 * Backend: GET/POST/PATCH/DELETE /api/cms/media.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FileText, ImageIcon, Search, Trash2 } from 'lucide-react';
import { useActiveShop } from '@/lib/shop-context';
import { formatRelative } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMedia, useUpdateMedia, useDeleteMedia } from '@/components/cms/api';
import { MediaUploader } from '@/components/cms/MediaUploader';
import type { CmsMediaDto } from '@/components/cms/types';

export const Route = createFileRoute('/_app/cms/media')({
  component: CmsMediaPage,
});

function isImage(mime: string | null): boolean {
  return !!mime && mime.startsWith('image/');
}

function formatBytes(n: number | null): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function CmsMediaPage() {
  const { activeShopId, activeShop } = useActiveShop();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CmsMediaDto | null>(null);

  const query = useMedia(activeShopId, { scope: 'all', limit: 200 });
  const all = query.data?.items ?? [];

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (m) =>
        m.filename.toLowerCase().includes(q) ||
        (m.alt ?? '').toLowerCase().includes(q) ||
        m.folder.toLowerCase().includes(q),
    );
  }, [all, search]);

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Media</h1>
            <span className="count-badge">{query.data?.total ?? 0}</span>
          </div>
          <p className="page-subtitle">
            Afbeeldingen & bestanden{activeShop ? ` voor ${activeShop.name}` : ''}.
          </p>
        </div>
      </header>

      {!activeShopId ? (
        <EmptyState icon={ImageIcon} title="Geen shop geselecteerd" description="Kies eerst een shop bovenaan." />
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <MediaUploader shopId={activeShopId} onUploaded={() => void query.refetch()} />
          </div>

          <div className="toolbar">
            <div className="search-input">
              <Search size={14} />
              <input
                aria-label="Zoek media"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Zoek op bestandsnaam, alt of map…"
              />
            </div>
          </div>

          {query.isError ? (
            <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
              <p className="error-text">Kon media niet laden. Probeer een refresh.</p>
            </div>
          ) : query.isLoading ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 12,
              }}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} height={160} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={search ? Search : ImageIcon}
              title={search ? 'Geen media gevonden' : 'Nog geen media'}
              description={
                search ? 'Pas je zoekterm aan.' : 'Upload je eerste afbeelding of bestand.'
              }
            />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 12,
              }}
            >
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="card"
                  onClick={() => setSelected(m)}
                  style={{ padding: 0, overflow: 'hidden', cursor: 'pointer', textAlign: 'left' }}
                >
                  <div
                    style={{
                      aspectRatio: '1 / 1',
                      background: 'var(--surface-2)',
                      display: 'grid',
                      placeItems: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    {isImage(m.mime) ? (
                      <img
                        src={m.url}
                        alt={m.alt ?? m.filename}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <FileText size={28} style={{ color: 'var(--theme-muted)' }} />
                    )}
                  </div>
                  <div style={{ padding: '8px 10px' }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={m.filename}
                    >
                      {m.filename}
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {formatBytes(m.sizeBytes)}
                      {m.shopId === null && (
                        <span className="badge badge-neutral" style={{ marginLeft: 6 }}>
                          globaal
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <MediaDrawer
        key={selected?.id ?? 'closed'}
        shopId={activeShopId}
        media={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
function MediaDrawer({
  shopId,
  media,
  onClose,
}: {
  shopId: string | null;
  media: CmsMediaDto | null;
  onClose: () => void;
}) {
  const open = media != null;
  const [alt, setAlt] = useState('');
  const [folder, setFolder] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useUpdateMedia(shopId);
  const del = useDeleteMedia(shopId);

  useEffect(() => {
    if (media) {
      setAlt(media.alt ?? '');
      setFolder(media.folder);
    }
    setConfirmDelete(false);
  }, [media]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!media) return;
    try {
      await update.mutateAsync({
        id: media.id,
        patch: { alt: alt.trim() || null, folder: folder.trim() || 'uploads' },
      });
      toast.success('Media bijgewerkt');
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Opslaan mislukt'));
    }
  }

  async function onDelete() {
    if (!media) return;
    try {
      await del.mutateAsync(media.id);
      toast.success('Media verwijderd');
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Verwijderen mislukt'));
    }
  }

  async function copyUrl() {
    if (!media) return;
    try {
      await navigator.clipboard.writeText(media.url);
      toast.success('URL gekopieerd');
    } catch {
      toast.error('Kopiëren mislukt');
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        width={460}
        title={media?.filename}
        subtitle={media ? `${media.mime ?? 'onbekend'} · ${formatRelative(media.createdAt)}` : undefined}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuleer
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} /> Verwijder
            </button>
            <button type="submit" form="media-form" className="btn btn-primary" disabled={update.isPending}>
              Opslaan
            </button>
          </>
        }
      >
        {media && (
          <>
            <div
              style={{
                borderRadius: 10,
                overflow: 'hidden',
                background: 'var(--surface-2)',
                marginBottom: 14,
                display: 'grid',
                placeItems: 'center',
                minHeight: 160,
              }}
            >
              {isImage(media.mime) ? (
                <img
                  src={media.url}
                  alt={media.alt ?? media.filename}
                  style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain' }}
                />
              ) : (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--theme-muted)' }}>
                  <FileText size={36} />
                </div>
              )}
            </div>

            <form id="media-form" onSubmit={onSubmit}>
              <FormField label="Alt-tekst" hint="Voor toegankelijkheid en SEO.">
                <input value={alt} onChange={(e) => setAlt(e.target.value)} />
              </FormField>
              <FormField label="Map">
                <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="uploads" />
              </FormField>
              <FormField label="URL">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={media.url} readOnly style={{ flex: 1 }} />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={copyUrl}>
                    Kopieer
                  </button>
                </div>
              </FormField>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                {[
                  media.width && media.height ? `${media.width}×${media.height}` : null,
                  formatBytes(media.sizeBytes),
                  media.shopId === null ? 'globaal' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </form>
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDelete}
        title="Media verwijderen?"
        message={
          <>
            <strong>{media?.filename}</strong> wordt verwijderd uit de library en opslag.
          </>
        }
        confirmLabel="Verwijder"
      />
    </>
  );
}

function errMsg(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string; error?: string } } };
  return e?.response?.data?.message ?? e?.response?.data?.error ?? fallback;
}
