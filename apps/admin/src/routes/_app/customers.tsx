/**
 * /customers — layout-route (rendert alleen <Outlet/>) zodat de geneste routes werken:
 *   /customers      -> customers.index.tsx (lijst)
 *   /customers/...  -> detail / new (bekijken + bewerken)
 * Zonder deze layout (parent met Outlet) zou TanStack /customers/:id de lijst tonen.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/customers')({
  component: CustomersLayout,
});

function CustomersLayout() {
  return <Outlet />;
}
