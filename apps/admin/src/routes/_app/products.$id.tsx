/**
 * /products/:id — gepoliste detail-page (2-koloms Shopify-style).
 *
 * Layout:
 *   - breadcrumb + title + status + actions
 *   - left col: Algemeen-card + Varianten-card
 *   - right col (sticky): Status, Foto's, Tags, SEO-placeholder
 *   - sticky save-bar onderaan (verschijnt bij dirty)
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Archive, ArrowLeft, Copy, Trash2 } from 'lucide-react';
import {
  useProductDetail,
  useUpdateProduct,
  useArchiveProduct,
  useAddVariant,
  useUpdateVariant,
  useDeleteVariant,
} from '@/components/product/api';
import { ProductForm, type ProductFormValues } from '@/components/product/ProductForm';
import { VariantRow, NewVariantForm } from '@/components/product/VariantForm';
import { ImageUploader } from '@/components/ImageUploader';
import { StatusBadge } from '@/components/product/StatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { toastBus } from '@/components/ui/Toast';
import { asApiError } from '@/lib/api';

export const Route = createFileRoute('/_app/products/$id')({
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const detail = useProductDetail(id);
  const update = useUpdateProduct(id);
  const archive = useArchiveProduct();
  const addVariant = useAddVariant(id);
  const updateVariant = useUpdateVariant(id);
  const deleteVariant = useDeleteVariant(id);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingValues, setPendingValues] = useState<ProductFormValues | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && dirty && pendingValues) {
        e.preventDefault();
        void handleSubmit(pendingValues);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, pendingValues]);

  if (detail.isLoading) {
    return (
      <div>
        <Skeleton width={140} height={14} />
        <div style={{ marginTop: 12 }}>
          <Skeleton width="40%" height={32} />
        </div>
        <div className="detail-grid" style={{ marginTop: 24 }}>
          <div className="section-stack">
            <Skeleton height={280} />
            <Skeleton height={180} />
          </div>
          <div className="aside-stack">
            <Skeleton height={120} />
            <Skeleton height={200} />
          </div>
        </div>
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
        <h2 className="card-title">Niet gevonden</h2>
        <p className="muted">
          Dit product bestaat niet of is verwijderd.{' '}
          <Link to="/products">Terug naar overzicht</Link>.
        </p>
      </div>
    );
  }

  const product = detail.data;

  async function handleSubmit(values: ProductFormValues) {
    setError(null);
    try {
      await update.mutateAsync({
        title: values.title,
        ...(values.slug ? { slug: values.slug } : {}),
        descriptionHtml: values.descriptionHtml || null,
        vendor: values.vendor || null,
        productType: values.productType || null,
        status: values.status,
        tags: values.tags,
      });
      setDirty(false);
      setPendingValues(null);
      toastBus.push('success', 'Product opgeslagen');
    } catch (err) {
      const e = asApiError(err);
      setError(e.message || 'Opslaan mislukt');
      toastBus.push('error', e.message || 'Opslaan mislukt');
    }
  }

  async function handleArchive() {
    setError(null);
    try {
      await archive.mutateAsync(id);
      toastBus.push('success', 'Product gearchiveerd');
      void navigate({ to: '/products' });
    } catch (err) {
      const e = asApiError(err);
      setError(e.message || 'Archiveren mislukt');
    }
  }

  return (
    <div>
      <Link
        to="/products"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12.5,
          color: 'var(--theme-muted)',
          textDecoration: 'none',
          marginBottom: 12,
        }}
      >
        <ArrowLeft size={13} /> Producten
      </Link>

      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{product.title}</h1>
            <StatusBadge status={product.status} />
          </div>
          <p className="page-subtitle">
            <code className="mono">/{product.slug}</code> · {product.variants.length} varianten
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled title="Komt in V2">
            <Copy size={13} /> Dupliceren
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setConfirmDelete(true)}
            title="Soft-archive"
          >
            <Archive size={13} /> Archiveren
          </button>
        </div>
      </header>

      {error && (
        <div className="card" style={{ borderColor: 'var(--theme-danger)', marginBottom: 16 }}>
          <p className="error-text" style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      <div className="detail-grid">
        {/* Hoofdkolom */}
        <div className="section-stack">
          <ProductForm
            initial={product}
            onSubmit={handleSubmit}
            submitLabel="Wijzigingen opslaan"
            submitting={update.isPending}
            onDirtyChange={(d, values) => {
              setDirty(d);
              setPendingValues(values);
            }}
            inline
          />

          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Varianten</h2>
                <p className="card-subtitle">{product.variants.length} variant{product.variants.length === 1 ? '' : 'en'}</p>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {product.variants.map((v) => (
                <VariantRow
                  key={v.id}
                  variant={v}
                  saving={updateVariant.isPending || deleteVariant.isPending}
                  onSave={async (patch) => {
                    await updateVariant.mutateAsync({ variantId: v.id, patch });
                    toastBus.push('success', 'Variant bijgewerkt');
                  }}
                  onDelete={async () => {
                    await deleteVariant.mutateAsync(v.id);
                    toastBus.push('success', 'Variant verwijderd');
                  }}
                />
              ))}
              <NewVariantForm
                creating={addVariant.isPending}
                onCreate={async (input) => {
                  await addVariant.mutateAsync(input);
                  toastBus.push('success', 'Variant toegevoegd');
                }}
              />
            </div>
          </div>
        </div>

        {/* Aside */}
        <aside className="aside-stack">
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Status</h2>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
              Verander direct de zichtbaarheid van dit product op alle channels.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <StatusBadge status={product.status} />
              <span className="muted" style={{ fontSize: 11.5 }}>
                Bewerk via "Algemeen → Status"
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Foto's</h2>
              <p className="card-subtitle">{product.images.length} afbeelding{product.images.length === 1 ? '' : 'en'}</p>
            </div>
            <ImageUploader productId={product.id} initial={product.images} />
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Tags</h2>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(product.tags ?? []).length === 0 ? (
                <span className="muted" style={{ fontSize: 12.5 }}>
                  Nog geen tags. Voeg toe via "Algemeen".
                </span>
              ) : (
                (product.tags ?? []).map((t) => (
                  <span key={t} className="badge">{t}</span>
                ))
              )}
            </div>
          </div>

          <div className="card" style={{ opacity: 0.65 }}>
            <div className="card-header">
              <h2 className="card-title">SEO</h2>
              <span className="badge badge-neutral">V2</span>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
              Meta-title, meta-description, og:image en kanaal-overrides komen in V2.
            </p>
          </div>
        </aside>
      </div>

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div
          className="modal-backdrop"
          onClick={() => !archive.isPending && setConfirmDelete(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="card-title" style={{ marginBottom: 8 }}>Product archiveren?</h2>
            <p className="muted" style={{ fontSize: 13.5, marginBottom: 20 }}>
              Het product wordt gearchiveerd (soft-delete). Je kunt het later weer activeren.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmDelete(false)}
                disabled={archive.isPending}
              >
                Annuleer
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleArchive}
                disabled={archive.isPending}
              >
                <Trash2 size={13} />
                {archive.isPending ? 'Bezig…' : 'Ja, archiveer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky save-bar */}
      {dirty && pendingValues && (
        <div className="sticky-savebar">
          <span className="savebar-label">Niet-opgeslagen wijzigingen</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setDirty(false);
              setPendingValues(null);
              detail.refetch();
            }}
            disabled={update.isPending}
          >
            Annuleer
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => pendingValues && handleSubmit(pendingValues)}
            disabled={update.isPending}
          >
            {update.isPending ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      )}
    </div>
  );
}
