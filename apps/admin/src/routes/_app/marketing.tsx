/**
 * /marketing — LAYOUT-route voor de marketing-sectie.
 *
 * Pure layout: rendert alleen <Outlet/> zodat de index-route
 * (marketing.index.tsx → product-feeds + analytics/tracking op /marketing)
 * correct in de outlet getoond wordt. Zelfde patroon als channels.tsx.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/marketing')({
  component: MarketingLayout,
});

function MarketingLayout() {
  return <Outlet />;
}
