/**
 * /settings — LAYOUT-route voor de settings-sectie.
 *
 * Rendert de gedeelde "Settings"-header + de tab-navigatie (Account / Gebruikers
 * / Tokens / Webhooks) en daaronder de <Outlet/> waarin de actieve child
 * (settings.index = Account, settings.users, settings.tokens, settings.webhooks)
 * getoond wordt.
 *
 * Vóór deze fix renderde settings.tsx zelf de Account/Sessie-pagina zónder
 * <Outlet/>, waardoor /settings/users etc. óók de Account-pagina toonden i.p.v.
 * hun eigen content. De Account-content is nu verplaatst naar settings.index.tsx.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { SettingsTabs } from '@/components/settings/SettingsTabs';

export const Route = createFileRoute('/_app/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <div>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Settings</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Account, gebruikers, API-tokens en webhooks.
        </p>
      </header>

      <SettingsTabs />

      <Outlet />
    </div>
  );
}
