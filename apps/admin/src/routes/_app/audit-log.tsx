/**
 * /audit-log — LAYOUT-route voor de audit-log-sectie.
 *
 * Pure layout: rendert alleen <Outlet/> zodat de index-route
 * (audit-log.index.tsx → de gefilterde log op /audit-log) correct in de outlet
 * getoond wordt. Mirror van channels.tsx.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/audit-log')({
  component: AuditLogLayout,
});

function AuditLogLayout() {
  return <Outlet />;
}
