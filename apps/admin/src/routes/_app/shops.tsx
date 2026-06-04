/**
 * /shops — layout-route.
 *
 * Rendert alleen <Outlet/> zodat de geneste routes werken:
 *   /shops      → shops.index.tsx (lijst)
 *   /shops/:id  → shops.$id.tsx (detail: overzicht + ConnectPanel + PaymentsPanel + matrix)
 * Zonder deze layout (parent met Outlet) zou TanStack /shops/:id de lijst tonen.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/shops')({
  component: ShopsLayout,
});

function ShopsLayout() {
  return <Outlet />;
}
