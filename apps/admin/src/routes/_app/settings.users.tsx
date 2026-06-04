/**
 * /settings/users — admin-gebruikers op de ECHTE API (`/api/admin/users`).
 *
 * Vervangt de oude mock-state. Platform-breed (niet shop-scoped). Lijst + zoek,
 * uitnodig/create-drawer (e-mail + tijdelijk wachtwoord + rol), edit-drawer
 * (rol wijzigen / deactiveren / wachtwoord resetten). SECURITY: wachtwoord-hash
 * verlaat de API nooit; we tonen of vragen nooit bestaande wachtwoorden.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Plus, MoreHorizontal, Edit3, Power, Users as UsersIcon, Search, Key,
} from 'lucide-react';
import { formatDate, initials } from '@/lib/format';
import {
  useUserList,
  useCreateUser,
  useUpdateUser,
  type UserDto,
  type UserRole,
  type UserListFilters,
} from '@/components/settings/api';
import { asApiError } from '@/lib/api';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/settings/users')({
  component: UsersPage,
});

const PAGE_SIZE = 100;

const ROLE_LABEL: Record<string, { label: string; klass: string }> = {
  admin: { label: 'Admin', klass: 'badge-accent' },
  manager: { label: 'Manager', klass: 'badge-info' },
  viewer: { label: 'Viewer', klass: 'badge-neutral' },
  disabled: { label: 'Gedeactiveerd', klass: 'badge-warning' },
};

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'admin', label: 'Admin — volledige toegang' },
  { value: 'manager', label: 'Manager — beheer zonder platform-settings' },
  { value: 'viewer', label: 'Viewer — alleen lezen' },
];

/** Afgeleide weergavenaam uit het e-mailadres (API kent geen aparte naam). */
function displayName(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ') || email;
}

function UsersPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<UserDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!actionMenu) return;
    function onClick() { setActionMenu(null); }
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [actionMenu]);

  const filters: UserListFilters = useMemo(
    () => ({ search: search || undefined, limit: PAGE_SIZE, offset: 0 }),
    [search],
  );

  const query = useUserList(filters);
  const updateActive = useUpdateUser(actionMenu ?? '__none__');

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const hasSearch = !!search;

  function toggleDisabled(u: UserDto) {
    const next = u.role === 'disabled';
    updateActive.mutate(
      { disabled: !next },
      {
        onSuccess: () => {
          toast.success(`${displayName(u.email)} ${next ? 'geactiveerd' : 'gedeactiveerd'}`);
        },
        onError: (err) => toast.error(asApiError(err).message),
      },
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Gebruikers</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">Admin-gebruikers van het CRM. API-tokens en webhooks staan in aparte pagina's.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={15} strokeWidth={2.2} />
          Gebruiker uitnodigen
        </button>
      </div>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <div className="search-input">
          <Search size={14} />
          <input
            aria-label="Zoek gebruikers"
            placeholder="Zoek op e-mail…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">Kon gebruikers niet laden. Controleer of de backend draait en probeer pagina-refresh.</p>
        </div>
      ) : query.isLoading ? (
        <SkeletonTableRows rows={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={hasSearch ? Search : UsersIcon}
          title={hasSearch ? 'Geen gebruikers gevonden' : 'Nog geen gebruikers'}
          description={
            hasSearch
              ? 'Pas je zoekopdracht aan om resultaten te zien.'
              : 'Nodig een collega uit om toegang te geven tot het CRM.'
          }
          action={
            !hasSearch ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> Gebruiker uitnodigen
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="table-wrap">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Aangemaakt</th>
                  <th>Status</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => {
                  const role = ROLE_LABEL[u.role] ?? { label: u.role, klass: 'badge-neutral' };
                  const disabled = u.role === 'disabled';
                  const name = displayName(u.email);
                  return (
                    <tr key={u.id} onClick={() => setEdit(u)} style={{ cursor: 'pointer', opacity: disabled ? 0.6 : 1 }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>
                            {initials(name)}
                          </div>
                          <div style={{ fontWeight: 500 }}>{name}</div>
                        </div>
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>{u.email}</td>
                      <td><span className={`badge ${role.klass}`}>{role.label}</span></td>
                      <td style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>{formatDate(u.createdAt)}</td>
                      <td>
                        {disabled ? (
                          <span className="badge badge-warning">Gedeactiveerd</span>
                        ) : (
                          <span className="badge badge-success">Actief</span>
                        )}
                      </td>
                      <td style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionMenu(actionMenu === u.id ? null : u.id);
                          }}
                          aria-label="Acties"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {actionMenu === u.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute',
                              top: '100%',
                              right: 8,
                              zIndex: 20,
                              background: 'var(--theme-card)',
                              border: '1px solid var(--border-strong)',
                              borderRadius: 10,
                              boxShadow: 'var(--shadow-lg)',
                              minWidth: 180,
                              padding: 4,
                              display: 'flex',
                              flexDirection: 'column',
                            }}
                          >
                            <ActionMenuItem
                              icon={<Edit3 size={13} />}
                              label="Bewerken"
                              onClick={() => { setActionMenu(null); setEdit(u); }}
                            />
                            <ActionMenuItem
                              icon={<Power size={13} />}
                              label={disabled ? 'Activeren' : 'Deactiveren'}
                              onClick={() => { setActionMenu(null); toggleDisabled(u); }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <UserEditDrawer user={edit} onClose={() => setEdit(null)} />
      <UserCreateDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function ActionMenuItem({
  icon, label, onClick, danger,
}: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', background: 'transparent', border: 'none', borderRadius: 6,
        color: danger ? 'var(--danger)' : 'var(--theme-text)',
        textAlign: 'left', cursor: 'pointer', fontSize: 13,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {icon} {label}
    </button>
  );
}

/** Create-drawer: nieuwe gebruiker met e-mail + tijdelijk wachtwoord + rol. */
function UserCreateDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('manager');
  const create = useCreateUser();

  useEffect(() => {
    if (open) {
      setEmail('');
      setPassword('');
      setRole('manager');
    }
  }, [open]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) {
      toast.error('E-mail is verplicht');
      return;
    }
    if (password.length < 8) {
      toast.error('Wachtwoord moet minimaal 8 tekens zijn');
      return;
    }
    create.mutate(
      { email: email.trim(), password, role },
      {
        onSuccess: () => {
          toast.success(`Gebruiker ${email.trim()} aangemaakt`);
          onClose();
        },
        onError: (err) => {
          const e = asApiError(err);
          toast.error(e.code === 'email_taken' ? 'Dit e-mailadres is al in gebruik' : e.message);
        },
      },
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Gebruiker uitnodigen"
      subtitle="Vul e-mail in, kies een rol en stel een tijdelijk wachtwoord in."
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="user-create-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Aanmaken…' : 'Aanmaken'}
          </button>
        </>
      }
    >
      <form id="user-create-form" onSubmit={onSubmit}>
        <FormField label="E-mail" required>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </FormField>
        <FormField label="Tijdelijk wachtwoord" required hint="Minimaal 8 tekens. De gebruiker logt hiermee de eerste keer in.">
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </FormField>
        <FormField label="Rol">
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </FormField>
      </form>
    </Drawer>
  );
}

/** Edit-drawer: rol wijzigen + optioneel wachtwoord resetten. */
function UserEditDrawer({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const open = user != null;
  const [role, setRole] = useState<UserRole>('manager');
  const [newPassword, setNewPassword] = useState('');
  const update = useUpdateUser(user?.id ?? '__none__');

  useEffect(() => {
    if (user) {
      setRole((user.role === 'disabled' ? 'manager' : (user.role as UserRole)) ?? 'manager');
      setNewPassword('');
    }
  }, [user]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const patch: { role?: UserRole; password?: string } = {};
    if (role !== user.role) patch.role = role;
    if (newPassword) {
      if (newPassword.length < 8) {
        toast.error('Wachtwoord moet minimaal 8 tekens zijn');
        return;
      }
      patch.password = newPassword;
    }
    if (Object.keys(patch).length === 0) {
      toast.info('Geen wijzigingen om op te slaan');
      onClose();
      return;
    }
    update.mutate(patch, {
      onSuccess: () => {
        toast.success(`${displayName(user.email)} bijgewerkt`);
        onClose();
      },
      onError: (err) => toast.error(asApiError(err).message),
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={user ? displayName(user.email) : undefined}
      subtitle={user?.email}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="user-edit-form" className="btn btn-primary" disabled={update.isPending}>
            {update.isPending ? 'Opslaan…' : 'Opslaan'}
          </button>
        </>
      }
    >
      {user && (
        <form id="user-edit-form" onSubmit={onSubmit}>
          <FormField label="E-mail">
            <input type="email" value={user.email} disabled readOnly />
          </FormField>
          <FormField label="Rol">
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Nieuw wachtwoord"
            hint="Laat leeg om het huidige wachtwoord te behouden. Minimaal 8 tekens."
          >
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
            />
          </FormField>
          {user.role === 'disabled' && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5,
                padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, marginTop: 8,
                color: 'var(--theme-muted)',
              }}
            >
              <Key size={13} />
              <span>Deze gebruiker is gedeactiveerd. Kies een andere rol om weer toegang te geven.</span>
            </div>
          )}
        </form>
      )}
    </Drawer>
  );
}
