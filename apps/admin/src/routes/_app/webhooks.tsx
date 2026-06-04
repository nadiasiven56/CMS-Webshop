/**
 * /webhooks — LAYOUT-route voor de webhook-delivery-monitor.
 *
 * Pure layout: rendert alleen <Outlet/> zodat de index-route
 * (webhooks.index.tsx → de delivery-log op /webhooks) correct in de outlet
 * getoond wordt. Mirror van channels.tsx.
 *
 * NB: dit is de DELIVERY-MONITOR, NIET de webhook-CRUD — die blijft op
 * /settings/webhooks.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/webhooks')({
  component: WebhooksLayout,
});

function WebhooksLayout() {
  return <Outlet />;
}
