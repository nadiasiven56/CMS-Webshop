/**
 * /channels — LAYOUT-route voor de kanalen-sectie.
 *
 * Deze route is een pure layout: hij rendert alleen <Outlet/> zodat zowel de
 * index-route (channels.index.tsx → de kanalen-LIJST op /channels) als de
 * child-route (channels.matrix.tsx → de product×kanaal-matrix op
 * /channels/matrix) correct in de outlet getoond worden.
 *
 * Vóór deze fix renderde channels.tsx zelf de volledige lijst zónder <Outlet/>,
 * waardoor /channels/matrix óók de lijst toonde i.p.v. de matrix.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/channels')({
  component: ChannelsLayout,
});

function ChannelsLayout() {
  return <Outlet />;
}
