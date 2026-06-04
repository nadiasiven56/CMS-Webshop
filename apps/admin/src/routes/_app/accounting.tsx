/**
 * /accounting — LAYOUT-route voor de boekhoud-koppeling-sectie.
 *
 * Pure layout: rendert alleen <Outlet/> zodat de index-route
 * (accounting.index.tsx → de koppelingen-lijst op /accounting) correct in de
 * outlet getoond wordt. Mirror van channels.tsx.
 *
 * NB: de oude /accounting-pagina (finance-facturen + OSS/UBL-exports) is bewaard
 * als accounting.tsx.pre-koppeling.bak — diezelfde data is ook bereikbaar via
 * /finance en /ledger. Zie components/accounting/REGISTER.md.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/accounting')({
  component: AccountingLayout,
});

function AccountingLayout() {
  return <Outlet />;
}
