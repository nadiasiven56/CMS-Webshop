/**
 * /orders — layout-route (rendert alleen <Outlet/>) zodat de geneste routes werken:
 *   /orders      -> orders.index.tsx (lijst)
 *   /orders/...  -> detail / new (bekijken + bewerken)
 * Zonder deze layout (parent met Outlet) zou TanStack /orders/:id de lijst tonen.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/orders')({
  component: OrdersLayout,
});

function OrdersLayout() {
  return <Outlet />;
}
