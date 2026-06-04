/** Herbruikbare loading / empty / error UI-states. */
import type { ReactNode } from 'react';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="state">
      <div className="spinner" aria-hidden />
      {label && <p>{label}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <h2>{title}</h2>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  message = 'Er ging iets mis.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state">
      <h2>Oeps</h2>
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn-outline" onClick={onRetry}>
          Opnieuw proberen
        </button>
      )}
    </div>
  );
}

/** Skeleton-grid voor de PLP terwijl producten laden. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="product-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div className="product-card" key={i}>
          <div className="product-card__media skeleton" style={{ aspectRatio: '1 / 1' }} />
          <div className="product-card__body">
            <div className="skeleton" style={{ height: 12, width: '50%' }} />
            <div className="skeleton" style={{ height: 16, width: '85%' }} />
            <div className="skeleton" style={{ height: 18, width: '40%', marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
