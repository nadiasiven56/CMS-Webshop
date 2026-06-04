import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { ShopLink } from '../components/ShopLink';
import { Spinner, EmptyState, ErrorState } from '../components/States';
import { formatMoney, isOnSale } from '../lib/format';
import { withShopQuery } from '../api/shop-context';
import { useCart } from '../state/CartProvider';
import { useToast } from '../state/ToastProvider';
import type { Variant } from '../api/types';

/** Bouw een leesbaar variant-label uit selectedOptions of val terug op SKU. */
function variantLabel(v: Variant): string {
  const opts = Object.values(v.selectedOptions ?? {});
  if (opts.length > 0) return opts.join(' / ');
  return v.sku;
}

export function ProductPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { addItem, loading: cartBusy } = useCart();
  const toast = useToast();

  const productQ = useAsync((signal) => api.getProduct(slug, signal), [slug]);

  const [variantId, setVariantId] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [qty, setQty] = useState(1);
  const [addError, setAddError] = useState<string | null>(null);

  const product = productQ.data;

  // default-variant = eerste op voorraad, anders eerste
  const selected: Variant | null = useMemo(() => {
    if (!product) return null;
    if (variantId) {
      return product.variants.find((v) => v.id === variantId) ?? null;
    }
    return (
      product.variants.find((v) => v.inStock) ?? product.variants[0] ?? null
    );
  }, [product, variantId]);

  if (productQ.loading) {
    return (
      <div className="container">
        <Spinner label="Product laden…" />
      </div>
    );
  }
  if (productQ.error) {
    const isNotFound =
      productQ.error instanceof ApiError && productQ.error.status === 404;
    return (
      <div className="container">
        {isNotFound ? (
          <EmptyState
            title="Product niet gevonden"
            message="Dit product bestaat niet (meer) in deze shop."
            action={
              <ShopLink to="/shop" className="btn btn-primary">
                Terug naar de shop
              </ShopLink>
            }
          />
        ) : (
          <ErrorState onRetry={productQ.reload} />
        )}
      </div>
    );
  }
  if (!product) return null;

  const images = product.images;
  const cover = images[activeImage] ?? images[0] ?? null;
  const onSale = selected
    ? isOnSale(selected.price, selected.compareAtPrice)
    : false;
  const maxQty = selected ? Math.max(0, selected.available) : 0;
  const canAdd = !!selected && selected.inStock && qty >= 1 && qty <= maxQty;

  const handleAdd = async () => {
    if (!selected) return;
    setAddError(null);
    try {
      await addItem(selected.id, qty);
      toast.push(`${product.title} toegevoegd aan je wagen`, 'success');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'insufficient_stock') {
        const avail = (err.details as { available?: number })?.available;
        setAddError(
          `Niet genoeg voorraad${
            typeof avail === 'number' ? ` (nog ${avail} beschikbaar)` : ''
          }.`,
        );
      } else {
        setAddError('Toevoegen mislukte. Probeer het opnieuw.');
      }
    }
  };

  return (
    <div className="container">
      <div className="breadcrumb">
        <ShopLink to="/">Home</ShopLink> / <ShopLink to="/shop">Shop</ShopLink> /{' '}
        {product.title}
      </div>

      <div className="pdp">
        <div className="pdp__gallery">
          <div className="pdp__main-image">
            {cover ? <img src={cover.url} alt={cover.alt ?? product.title} /> : null}
          </div>
          {images.length > 1 && (
            <div className="pdp__thumbs">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  className={`pdp__thumb ${i === activeImage ? 'active' : ''}`}
                  onClick={() => setActiveImage(i)}
                  aria-label={`Afbeelding ${i + 1}`}
                >
                  <img src={img.url} alt={img.alt ?? ''} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pdp__info">
          {product.vendor && (
            <span className="product-card__vendor">{product.vendor}</span>
          )}
          <h1>{product.title}</h1>

          <div className="pdp__price">
            {formatMoney(selected?.price ?? product.price)}
            {onSale && (
              <span className="price-compare">
                {formatMoney(selected?.compareAtPrice)}
              </span>
            )}
          </div>

          {product.variants.length > 1 && (
            <>
              <div className="field">
                <label>Variant</label>
              </div>
              <div className="variant-options">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    className={`variant-chip ${
                      selected?.id === v.id ? 'active' : ''
                    }`}
                    disabled={!v.inStock}
                    onClick={() => {
                      setVariantId(v.id);
                      setQty(1);
                      setAddError(null);
                    }}
                  >
                    {variantLabel(v)}
                  </button>
                ))}
              </div>
            </>
          )}

          {selected && (
            <p className={`stock-line ${selected.inStock ? 'in' : 'out'}`}>
              {selected.inStock
                ? `Op voorraad — ${selected.available} beschikbaar`
                : 'Uitverkocht'}
            </p>
          )}

          <div className="qty-row">
            <div className="qty-stepper">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                aria-label="Minder"
              >
                −
              </button>
              <span>{qty}</span>
              <button
                onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                disabled={qty >= maxQty}
                aria-label="Meer"
              >
                +
              </button>
            </div>
            <button
              className="btn btn-primary btn-lg"
              disabled={!canAdd || cartBusy}
              onClick={handleAdd}
            >
              {cartBusy ? 'Bezig…' : 'In winkelwagen'}
            </button>
          </div>

          {addError && <div className="alert alert-error">{addError}</div>}

          {product.descriptionHtml && (
            <div
              className="richtext"
              style={{ marginTop: 24 }}
              dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
            />
          )}

          {product.tags.length > 0 && (
            <div className="tag-row" style={{ marginTop: 20 }}>
              {product.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          )}

          <button
            className="btn-ghost"
            style={{ marginTop: 20 }}
            onClick={() => navigate(withShopQuery('/cart'))}
          >
            Naar winkelwagen →
          </button>
        </div>
      </div>
    </div>
  );
}
