/**
 * /analytics — LAYOUT-route voor de statistieken-sectie ("Statistieken").
 *
 * Pure layout: rendert alleen <Outlet/> zodat de index-route
 * (analytics.index.tsx → het BI-dashboard op /analytics) correct in de outlet
 * getoond wordt. Zelfde patroon als channels.tsx / marketing.tsx.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/analytics')({
  component: AnalyticsLayout,
});

function AnalyticsLayout() {
  return <Outlet />;
}
