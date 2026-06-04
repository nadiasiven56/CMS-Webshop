import type { CSSProperties } from 'react';

interface Props {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ width = '100%', height = 16, radius = 6, className, style }: Props) {
  return (
    <div
      className={`skeleton ${className ?? ''}`}
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

interface SkeletonRowsProps {
  rows?: number;
  height?: number;
  gap?: number;
}

export function SkeletonRows({ rows = 5, height = 20, gap = 12 }: SkeletonRowsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </div>
  );
}

export function SkeletonCard({ height = 120 }: { height?: number }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <Skeleton width="40%" height={14} />
      <div style={{ marginTop: 14 }}>
        <Skeleton height={height - 60} />
      </div>
    </div>
  );
}

export function SkeletonTableRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th><Skeleton width={80} height={11} /></th>
            <th><Skeleton width={120} height={11} /></th>
            <th><Skeleton width={80} height={11} /></th>
            <th><Skeleton width={80} height={11} /></th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              <td><Skeleton height={14} /></td>
              <td><Skeleton height={14} /></td>
              <td><Skeleton height={14} width="60%" /></td>
              <td><Skeleton height={14} width="40%" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
