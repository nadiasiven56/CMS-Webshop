import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { ShopLink } from '../components/ShopLink';
import { Spinner, EmptyState, ErrorState } from '../components/States';
import { formatMoneyIn, isOnSale } from '../lib/format';
import { sanitizeHtml } from '../lib/sanitize';
import { useDocumentHead } from '../lib/useDocumentHead';
import { withShopQuery } from '../api/shop-context';
import { useCart } from '../state/CartProvider';
import { useShop } from '../state/ShopProvider';
import { useToast } from '../state/ToastProvider';
import type { ProductDetail, Variant } from '../api/types';

/** Maak van een (mogelijk relatieve) image-URL een absolute URL voor og:/JSON-LD. */
function absoluteUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === 'undefined') return url;
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
}

/** Bouw plain-text uit een (mogelijk HTML-)beschrijving voor meta-description. */
function plainText(html: string | null | undefined, max = 160): string {
  if (!html) return '';
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Bouw een leesbaar variant-label uit selectedOptions of val terug op SKU. */
function variantLabel(v: Variant): string {
  const opts = Object.values(v.selectedOptions ?? {});
  if (opts.length > 0) return opts.join(' / ');
  return v.sku;
}

function ProductSeo({
  product,
  selected,
  shopName,
  currency,
}: {
  product: ProductDetail;
  selected: Variant | null;
  shopName: string;
  currency: string;
}) {
  const priceForLd = selected?.price ?? product.price ?? undefined;
  const description =
    plainText(product.descriptionHtml) ||
    `${product.title}${product.vendor ? ` van ${product.vendor}` : ''} — koop online bij ${shopName}.`;
  const image = absoluteUrl(product.images[0]?.url);

  const jsonLd = useMemo(() => {
    const inStock = product.variants.some((v) => v.inStock);
    const offers = priceForLd
      ? {
          '@type': 'Offer',
          price: Number(priceForLd).toFixed(2),
          priceCurrency: currency,
          availability: inStock
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
        }
      : undefined;
    return {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.title,
      ...(image ? { image: [image] } : {}),
      ...(product.vendor ? { brand: { '@type': 'Brand', name: product.vendor } } : {}),
      ...(description ? { description } : {}),
      ...(offers ? { offers } : {}),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, product.title, priceForLd, currency, image, description]);

  useDocumentHead({
    title: `${product.title} — ${shopName}`,
    description,
    ogType: 'product',
    image,
    jsonLd,
  });
  return null;
}

export function ProductPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { addItem, loading: cartBusy } = useCart();
  const { shop } = useShop();
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
      <ProductSeo
        product={product}
        selected={selected}
        shopName={shop?.name ?? 'Webshop'}
        currency={shop?.currency ?? 'EUR'}
      />
      <div className="breadcrumb">
        <ShopLink to="/">Home</ShopLink> / <ShopLink to="/shop">Shop</ShopLink> /{' '}
        {product.title}
      </div>

      <div className="pdp">
        <div className="pdp__gallery">
          <div className="pdp__main-image">
            {cover ? (
              <img
                src={cover.url}
                alt={cover.alt ?? product.title}
                width={800}
                height={800}
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
            ) : null}
          </div>
          {images.length > 1 && (
            <div className="pdp__thumbs">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  className={`pdp__thumb ${i === activeImage ? 'active' : ''}`}
                  onClick={() => setActiveImage(i)}
                  aria-label={`Afbeelding ${i + 1}`}
                  aria-pressed={i === activeImage}
                >
                  <img src={img.url} alt={img.alt ?? ''} loading="lazy" />
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
            {formatMoneyIn(
              selected?.price ?? product.price,
              shop?.locale,
              shop?.currency,
            )}
            {onSale && (
              <span className="price-compare">
                {formatMoneyIn(
                  selected?.compareAtPrice,
                  shop?.locale,
                  shop?.currency,
                )}
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
                    aria-pressed={selected?.id === v.id}
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
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(product.descriptionHtml),
              }}
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
