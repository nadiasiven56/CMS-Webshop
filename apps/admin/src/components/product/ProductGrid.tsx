import { Link } from '@tanstack/react-router';
import { Package } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { StockBar } from '@/components/ui/StockBar';
import type { ProductListItem } from './types';

interface Props {
  items: ProductListItem[];
}

function formatPrice(v: number | null | undefined): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(v);
}

export function ProductGrid({ items }: Props) {
  return (
    <div className="product-grid">
      {items.map((p) => {
        const extra = p as ProductListItem & {
          pricePrimary?: number;
          availableTotal?: number;
        };
        return (
          <Link
            key={p.id}
            to="/products/$id"
            params={{ id: p.id }}
            className="product-card"
          >
            <div className="product-card-thumb">
              {p.primaryImageUrl ? (
                <img src={p.primaryImageUrl} alt={p.title} loading="lazy" />
              ) : (
                <div className="product-card-thumb-fallback">
                  <Package size={20} style={{ marginBottom: 4 }} />
                  <div>{p.id.slice(0, 8).toUpperCase()}</div>
                </div>
              )}
              <div className="product-card-status">
                <StatusBadge status={p.status} />
              </div>
            </div>
            <div className="product-card-body">
              <h3 className="product-card-title">{p.title}</h3>
              <div className="product-card-meta">
                {p.vendor && <span className="badge">{p.vendor}</span>}
                {p.productType && <span className="badge badge-neutral">{p.productType}</span>}
              </div>
              {extra.availableTotal !== undefined && (
                <StockBar available={extra.availableTotal ?? 0} showLabel />
              )}
              <div className="product-card-footer">
                <span className="product-card-price">{formatPrice(extra.pricePrimary)}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                  {p.variantCount} variant{p.variantCount === 1 ? '' : 'en'}
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
