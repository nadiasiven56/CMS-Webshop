/**
 * Pure-SVG sparkline / area-chart / horizontal bar chart.
 * Geen recharts nodig (dep-vrij), V1 simpel maar mooi.
 */
interface SparklineProps {
  values: number[];
  width?: number | string;
  height?: number;
  color?: string;
  fill?: boolean;
}

export function Sparkline({
  values,
  width = '100%',
  height = 36,
  color = 'var(--theme-accent)',
  fill = false,
}: SparklineProps) {
  if (values.length === 0) return null;
  const w = 200;
  const h = height;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = w / Math.max(1, values.length - 1);

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${path} L${w},${h} L0,${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width, height, display: 'block' }}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.32" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#spark-fill)" />
        </>
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface AreaChartProps {
  data: Array<{ label: string; value: number }>;
  height?: number;
  color?: string;
}

export function AreaChart({ data, height = 220, color = 'var(--theme-accent)' }: AreaChartProps) {
  if (data.length === 0) return null;
  const w = 800;
  const h = height;
  const padX = 32;
  const padY = 24;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const values = data.map((d) => d.value);
  const min = 0;
  const max = Math.max(...values) * 1.1;
  const range = max - min || 1;
  const stepX = innerW / Math.max(1, data.length - 1);

  const points = data.map((d, i) => {
    const x = padX + i * stepX;
    const y = padY + innerH - ((d.value - min) / range) * innerH;
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${path} L${(padX + innerW).toFixed(1)},${(padY + innerH).toFixed(1)} L${padX},${(padY + innerH).toFixed(1)} Z`;

  // grid-lines (4 horizontaal)
  const gridLines = Array.from({ length: 4 }, (_, i) => padY + (innerH / 3) * i);
  // Y-axis labels
  const yLabels = Array.from({ length: 4 }, (_, i) => {
    const v = max - (range / 3) * i;
    return Math.round(v);
  });

  // X-axis labels — toon eerste, midden, laatste
  const xLabelIdx = [0, Math.floor(data.length / 2), data.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height, display: 'block' }}>
      <defs>
        <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridLines.map((y, i) => (
        <line
          key={i}
          x1={padX}
          x2={w - padX}
          y1={y}
          y2={y}
          stroke="var(--border-subtle)"
          strokeDasharray="3 3"
        />
      ))}
      {yLabels.map((v, i) => (
        <text
          key={i}
          x={padX - 8}
          y={gridLines[i]! + 3}
          fontSize="10"
          fill="var(--text-faint)"
          textAnchor="end"
        >
          {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
        </text>
      ))}
      <path d={areaPath} fill="url(#area-fill)" />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* dots on data points */}
      {points.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === points.length - 1 ? 4 : 0}
          fill={color}
          stroke="var(--theme-card)"
          strokeWidth={2}
        />
      ))}
      {xLabelIdx.map((idx) => (
        <text
          key={idx}
          x={points[idx]?.[0] ?? padX}
          y={h - 6}
          fontSize="10"
          fill="var(--text-faint)"
          textAnchor="middle"
        >
          {data[idx]?.label ?? ''}
        </text>
      ))}
    </svg>
  );
}

interface HBarChartProps {
  data: Array<{ label: string; value: number }>;
  format?: (v: number) => string;
}

export function HBarChart({ data, format }: HBarChartProps) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={d.label}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12.5,
                marginBottom: 4,
              }}
            >
              <span style={{ color: 'var(--theme-text)', fontWeight: 500 }}>{d.label}</span>
              <span style={{ color: 'var(--theme-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {format ? format(d.value) : d.value}
              </span>
            </div>
            <div
              style={{
                height: 8,
                background: 'var(--surface-1)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background:
                    'linear-gradient(90deg, var(--theme-accent), var(--theme-accent-secondary))',
                  borderRadius: 999,
                  transition: 'width var(--duration-base) var(--ease)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
