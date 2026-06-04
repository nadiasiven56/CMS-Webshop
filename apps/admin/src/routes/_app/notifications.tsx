/**
 * /notifications — LAYOUT-route voor de e-mail/notifications-sectie.
 *
 * Pure layout: rendert alleen <Outlet/> zodat de index-route
 * (notifications.index.tsx → het e-mail-beheer op /notifications) correct in de
 * outlet getoond wordt. Mirror van channels.tsx.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/notifications')({
  component: NotificationsLayout,
});

function NotificationsLayout() {
  return <Outlet />;
}
