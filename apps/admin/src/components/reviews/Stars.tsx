/**
 * Stars — kleine, herbruikbare ster-weergave voor reviews.
 *
 * Toont `rating` (0..5, kan fractioneel zijn) als gevulde/lege sterren. De
 * gevulde sterren krijgen de accent-kleur; lege sterren de subtiele border-tint.
 * Geen externe libs — pure lucide Star-iconen met een clip-overlay voor halve.
 */
import { Star } from 'lucide-react';

export function Stars({
  rating,
  size = 14,
  outOf = 5,
}: {
  rating: number | null;
  size?: number;
  outOf?: number;
}) {
  const value = rating == null ? 0 : Math.max(0, Math.min(outOf, rating));
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
      aria-label={rating == null ? 'geen beoordeling' : `${value} van ${outOf} sterren`}
      role="img"
    >
      {Array.from({ length: outOf }).map((_, i) => {
        const fill = Math.max(0, Math.min(1, value - i)); // 0..1 voor deze ster
        return (
          <span key={i} style={{ position: 'relative', display: 'inline-flex', width: size, height: size }}>
            {/* lege ster (achtergrond) */}
            <Star
              size={size}
              strokeWidth={1.6}
              style={{ color: 'var(--border-default)', position: 'absolute', inset: 0 }}
            />
            {/* gevuld deel, geclipt op fractie */}
            {fill > 0 && (
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  overflow: 'hidden',
                  width: `${fill * 100}%`,
                  display: 'inline-flex',
                }}
              >
                <Star
                  size={size}
                  strokeWidth={1.6}
                  style={{ color: '#f5a623', fill: '#f5a623', flexShrink: 0 }}
                />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
