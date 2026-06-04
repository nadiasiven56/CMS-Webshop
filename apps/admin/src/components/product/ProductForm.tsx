import { useEffect, useMemo, useState } from 'react';
import type { ProductWithRelations, ProductStatus } from './types';

export interface ProductFormValues {
  title: string;
  slug?: string;
  vendor: string;
  productType: string;
  descriptionHtml: string;
  status: ProductStatus;
  tags: string[];
}

interface Props {
  initial?: Partial<ProductWithRelations>;
  onSubmit: (values: ProductFormValues) => Promise<void> | void;
  submitLabel?: string;
  submitting?: boolean;
  /** Wanneer true: form wordt geneste in detail-page (geen submit-knop, save-bar handelt dat). */
  inline?: boolean;
  onDirtyChange?: (dirty: boolean, values: ProductFormValues) => void;
}

export function ProductForm({
  initial,
  onSubmit,
  submitLabel = 'Opslaan',
  submitting,
  inline,
  onDirtyChange,
}: Props) {
  const initialValues: ProductFormValues = useMemo(
    () => ({
      title: initial?.title ?? '',
      slug: initial?.slug ?? '',
      vendor: initial?.vendor ?? '',
      productType: initial?.productType ?? '',
      descriptionHtml: initial?.descriptionHtml ?? '',
      status: ((initial?.status as ProductStatus) ?? 'draft') as ProductStatus,
      tags: initial?.tags ?? [],
    }),
    [initial],
  );

  const [title, setTitle] = useState(initialValues.title);
  const [slug, setSlug] = useState(initialValues.slug ?? '');
  const [vendor, setVendor] = useState(initialValues.vendor);
  const [productType, setProductType] = useState(initialValues.productType);
  const [descriptionHtml, setDescriptionHtml] = useState(initialValues.descriptionHtml);
  const [status, setStatus] = useState<ProductStatus>(initialValues.status);
  const [tagsRaw, setTagsRaw] = useState((initialValues.tags ?? []).join(', '));

  const currentValues: ProductFormValues = {
    title: title.trim(),
    ...(slug.trim() ? { slug: slug.trim() } : {}),
    vendor: vendor.trim(),
    productType: productType.trim(),
    descriptionHtml,
    status,
    tags: tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  };

  const dirty =
    currentValues.title !== initialValues.title ||
    (currentValues.slug ?? '') !== (initialValues.slug ?? '') ||
    currentValues.vendor !== initialValues.vendor ||
    currentValues.productType !== initialValues.productType ||
    currentValues.descriptionHtml !== initialValues.descriptionHtml ||
    currentValues.status !== initialValues.status ||
    currentValues.tags.join(',') !== (initialValues.tags ?? []).join(',');

  useEffect(() => {
    onDirtyChange?.(dirty, currentValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, slug, vendor, productType, descriptionHtml, status, tagsRaw]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(currentValues);
      }}
    >
      <div className="card">
        <div className="card-header" style={{ marginBottom: 12 }}>
          <h2 className="card-title">Algemeen</h2>
        </div>

        <div className="field">
          <label htmlFor="p-title">Titel</label>
          <input
            id="p-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="bv. La Pavoni Stradivari Espresso"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="p-slug">URL-slug (optioneel — leeg = auto)</label>
          <input
            id="p-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="auto-generated"
          />
        </div>

        <div className="field">
          <label htmlFor="p-desc">Omschrijving</label>
          <textarea
            id="p-desc"
            value={descriptionHtml}
            onChange={(e) => setDescriptionHtml(e.target.value)}
            rows={6}
            placeholder="Vertel over dit product (Markdown of HTML)…"
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          <div className="field">
            <label htmlFor="p-vendor">Vendor</label>
            <input
              id="p-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Merk"
            />
          </div>
          <div className="field">
            <label htmlFor="p-type">Product type</label>
            <input
              id="p-type"
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
              placeholder="bv. Espressomachine"
            />
          </div>
          <div className="field">
            <label htmlFor="p-status">Status</label>
            <select
              id="p-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProductStatus)}
            >
              <option value="draft">Concept</option>
              <option value="active">Actief</option>
              <option value="archived">Gearchiveerd</option>
            </select>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="p-tags">Tags (komma-gescheiden)</label>
          <input
            id="p-tags"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="koffie, espresso"
          />
        </div>
      </div>

      {!inline && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Bezig…' : submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}
