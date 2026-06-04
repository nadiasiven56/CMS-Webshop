import { ShopLink } from './ShopLink';
import { formatMoney, isOnSale } from '../lib/format';
import type { ProductListItem } from '../api/types';

export function ProductCard({ product }: { product: ProductListItem }) {
  const onSale = isOnSale(product.price, product.compareAtPrice);
  return (
    <ShopLink to={`/product/${product.slug}`} className="product-card">
      <div className="product-card__media">
        {product.primaryImageUrl ? (
          <img src={product.primaryImageUrl} alt={product.title} loading="lazy" />
        ) : null}
      </div>
      <div className="product-card__body">
        {product.vendor && (
          <span className="product-card__vendor">{product.vendor}</span>
        )}
        <span className="product-card__title">{product.title}</span>
        <span className="product-card__price">
          {product.price != null && product.price !== '' ? 'vanaf ' : ''}
          {formatMoney(product.price)}
          {onSale && (
            <span className="price-compare">{formatMoney(product.compareAtPrice)}</span>
          )}
        </span>
      </div>
    </ShopLink>
  );
}
