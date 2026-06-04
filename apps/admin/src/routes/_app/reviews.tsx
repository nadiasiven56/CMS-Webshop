/**
 * /reviews — LAYOUT-route voor de reviews-sectie.
 *
 * Pure layout: rendert alleen <Outlet/> zodat de index-route (reviews.index.tsx
 * → de sources + samenvatting + recente reviews op /reviews) correct in de
 * outlet getoond wordt. Volgt het channels.tsx-patroon en vermijdt de bekende
 * TanStack Outlet-bug (layout-route mag NIET zelf de lijst renderen).
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/reviews')({
  component: ReviewsLayout,
});

function ReviewsLayout() {
  return <Outlet />;
}
