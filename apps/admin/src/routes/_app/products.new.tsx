import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ProductForm, type ProductFormValues } from '@/components/product/ProductForm';
import { useCreateProduct } from '@/components/product/api';
import { toastBus } from '@/components/ui/Toast';
import { asApiError } from '@/lib/api';

export const Route = createFileRoute('/_app/products/new')({
  component: NewProductPage,
});

function NewProductPage() {
  const navigate = useNavigate();
  const create = useCreateProduct();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: ProductFormValues) {
    setError(null);
    try {
      const product = await create.mutateAsync({
        title: values.title,
        ...(values.slug ? { slug: values.slug } : {}),
        descriptionHtml: values.descriptionHtml || null,
        vendor: values.vendor || null,
        productType: values.productType || null,
        status: values.status,
        tags: values.tags,
        options: [],
        variants: [],
      });
      toastBus.push('success', 'Product aangemaakt');
      void navigate({ to: '/products/$id', params: { id: product.id } });
    } catch (err) {
      const e = asApiError(err);
      setError(e.message || 'Aanmaken mislukt');
      toastBus.push('error', e.message || 'Aanmaken mislukt');
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
          <h1 className="page-title">Nieuw product</h1>
          <p className="page-subtitle">
            Slug en eerste default-variant worden automatisch aangemaakt.
          </p>
        </div>
      </header>

      {error && (
        <div className="card" style={{ borderColor: 'var(--theme-danger)', marginBottom: 16 }}>
          <p className="error-text" style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      <div style={{ maxWidth: 760 }}>
        <ProductForm
          onSubmit={handleSubmit}
          submitLabel="Product aanmaken"
          submitting={create.isPending}
        />
      </div>
    </div>
  );
}
