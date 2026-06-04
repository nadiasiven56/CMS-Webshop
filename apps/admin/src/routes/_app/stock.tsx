/**
 * /stock — layout-route (rendert alleen <Outlet/>) zodat de geneste routes werken:
 *   /stock      -> stock.index.tsx (lijst)
 *   /stock/...  -> detail / new (bekijken + bewerken)
 * Zonder deze layout (parent met Outlet) zou TanStack /stock/:id de lijst tonen.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/stock')({
  component: StockLayout,
});

function StockLayout() {
  return <Outlet />;
}
