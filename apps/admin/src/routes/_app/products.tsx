/**
 * /products — layout-route (rendert alleen <Outlet/>) zodat de geneste routes werken:
 *   /products      -> products.index.tsx (lijst)
 *   /products/...  -> detail / new (bekijken + bewerken)
 * Zonder deze layout (parent met Outlet) zou TanStack /products/:id de lijst tonen.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/products')({
  component: ProductsLayout,
});

function ProductsLayout() {
  return <Outlet />;
}
