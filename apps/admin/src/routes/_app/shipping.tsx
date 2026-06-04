/**
 * /shipping — LAYOUT-route voor de verzending-sectie.
 *
 * Pure layout: rendert alleen <Outlet/> zodat de index-route
 * (shipping.index.tsx → de vervoerders + shipments op /shipping) correct in de
 * outlet getoond wordt. Dit volgt het channels.tsx-patroon en vermijdt de
 * bekende TanStack Outlet-bug (layout-route mag NIET zelf de lijst renderen).
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/shipping')({
  component: ShippingLayout,
});

function ShippingLayout() {
  return <Outlet />;
}
