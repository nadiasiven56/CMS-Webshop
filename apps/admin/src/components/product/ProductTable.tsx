import { Link } from '@tanstack/react-router';
import { Package } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { ProductListItem } from './types';

interface Props {
  items: ProductListItem[];
  loading?: boolean;
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('nl-NL', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return iso;
  }
}

function formatPrice(v: number | null | undefined): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(v);
}

export function ProductTable({ items, loading }: Props) {
  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <span className="muted">Laden…</span>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: '40%' }}>Product</th>
            <th>Vendor</th>
            <th>Type</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Prijs</th>
            <th style={{ textAlign: 'right' }}>Voorraad</th>
            <th>Bijgewerkt</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            const extra = p as ProductListItem & {
              pricePrimary?: number;
              availableTotal?: number;
            };
            return (
              <tr key={p.id}>
                <td>
                  <Link
                    to="/products/$id"
                    params={{ id: p.id }}
                    className="table-row-link"
                  >
                    <Thumbnail url={p.primaryImageUrl} alt={p.title} />
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontWeight: 600, color: 'var(--theme-text)' }}>
                        {p.title}
                      </strong>
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                        /{p.slug} · {p.variantCount} variant{p.variantCount === 1 ? '' : 'en'}
                      </div>
                    </div>
                  </Link>
                </td>
                <td>{p.vendor || <span className="muted">—</span>}</td>
                <td>{p.productType || <span className="muted">—</span>}</td>
                <td><StatusBadge status={p.status} /></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatPrice(extra.pricePrimary)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {extra.availableTotal !== undefined ? (
                    <StockPill available={extra.availableTotal} />
                  ) : (
                    <span className="pill">{p.variantCount}</span>
                  )}
                </td>
                <td>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {formatRelative(p.updatedAt)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Thumbnail({ url, alt }: { url: string | null; alt?: string }) {
  if (!url) {
    return (
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: 'var(--surface-1)',
          border: '1px solid var(--border-default)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--theme-muted)',
          flexShrink: 0,
        }}
      >
        <Package size={16} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt ?? ''}
      loading="lazy"
      style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        objectFit: 'cover',
        border: '1px solid var(--border-default)',
        flexShrink: 0,
      }}
    />
  );
}

function StockPill({ available }: { available: number }) {
  const cls =
    available <= 5 ? 'badge-danger' : available <= 15 ? 'badge-warning' : 'badge-success';
  return <span className={`badge ${cls}`}>{available}</span>;
}
