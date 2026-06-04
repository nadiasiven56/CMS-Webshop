/**
 * /discounts — LAYOUT-route voor de kortingen-sectie.
 *
 * Pure layout: rendert alleen <Outlet/> zodat de index-route (discounts.index.tsx
 * → de kortingen-LIJST op /discounts) correct in de outlet getoond wordt. Mirror
 * van channels.tsx.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/discounts')({
  component: DiscountsLayout,
});

function DiscountsLayout() {
  return <Outlet />;
}
