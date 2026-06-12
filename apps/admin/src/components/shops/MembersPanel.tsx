/**
 * MembersPanel — ledenbeheer op de shop-detailpagina (multi-user).
 *
 * Backend-contract:
 *   GET    /api/shops/:id/members            → [{ id, userId, email, role, createdAt }]
 *   POST   /api/shops/:id/members            { email, role: 'owner'|'staff' }
 *                                            → 404 { error: 'user_not_found' }
 *   DELETE /api/shops/:id/members/:memberId  → 409 { error: 'last_owner' }
 *
 * Owners kunnen mede-eigenaren en staff toevoegen op e-mailadres; de gebruiker
 * moet al een account hebben (registratie via /register). De laatste owner kan
 * niet verwijderd worden — de backend geeft dan 409 'last_owner'.
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Loader2, Trash2, UserPlus, Users } from 'lucide-react';
import { api, asApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { FormField } from '@/components/ui/FormField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export interface ShopMemberDto {
  id: string;
  userId: string;
  email: string;
  role: 'owner' | 'staff';
  createdAt: string;
}

const MEMBERS_KEY = (shopId: string) => ['shops-admin', 'members', shopId] as const;

function useShopMembers(shopId: string) {
  return useQuery({
    queryKey: MEMBERS_KEY(shopId),
    queryFn: async (): Promise<ShopMemberDto[]> => {
      const res = await api.get<ShopMemberDto[] | { items: ShopMemberDto[] }>(
        `/shops/${shopId}/members`,
      );
      // Contract: kale array; wees tolerant voor een evt. { items } envelope.
      return Array.isArray(res.data) ? res.data : (res.data.items ?? []);
    },
  });
}

function useAddMember(shopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; role: 'owner' | 'staff' }) => {
      const res = await api.post(`/shops/${shopId}/members`, input);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MEMBERS_KEY(shopId) });
    },
  });
}

function useRemoveMember(shopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      await api.delete(`/shops/${shopId}/members/${memberId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MEMBERS_KEY(shopId) });
    },
  });
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  staff: 'Staff',
};

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

export function MembersPanel({ shopId }: { shopId: string }) {
  const membersQuery = useShopMembers(shopId);
  const addMember = useAddMember(shopId);
  const removeMember = useRemoveMember(shopId);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'staff'>('staff');
  const [confirmRemove, setConfirmRemove] = useState<ShopMemberDto | null>(null);

  const members = membersQuery.data ?? [];

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    try {
      await addMember.mutateAsync({ email: trimmed, role });
      toast.success(`"${trimmed}" toegevoegd als ${(ROLE_LABELS[role] ?? role).toLowerCase()}`);
      setEmail('');
      setRole('staff');
    } catch (err) {
      const apiErr = asApiError(err);
      toast.error(
        apiErr.code === 'user_not_found'
          ? `Geen account gevonden voor "${trimmed}". Diegene moet zich eerst registreren via de registratiepagina.`
          : apiErr.code === 'member_exists' || apiErr.status === 409
            ? 'Deze gebruiker is al lid van deze shop.'
            : `Lid toevoegen mislukt: ${apiErr.message}`,
      );
    }
  }

  async function onRemove(member: ShopMemberDto) {
    try {
      await removeMember.mutateAsync(member.id);
      toast.success(`"${member.email}" verwijderd uit deze shop`);
    } catch (err) {
      const apiErr = asApiError(err);
      toast.error(
        apiErr.code === 'last_owner'
          ? 'Kan de laatste owner niet verwijderen — maak eerst iemand anders owner.'
          : `Verwijderen mislukt: ${apiErr.message}`,
      );
    } finally {
      setConfirmRemove(null);
    }
  }

  return (
    <section style={{ marginTop: 24 }} data-members-panel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Users size={16} style={{ color: 'var(--theme-accent)' }} />
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Leden</h2>
        {!membersQuery.isLoading && <span className="count-badge">{members.length}</span>}
      </div>

      <div
        className="card"
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, marginBottom: 8 }}>
          Leden hebben toegang tot deze shop. <strong>Owners</strong> beheren leden en de
          webshop-koppeling, <strong>staff</strong> werkt mee in producten en orders. Toevoegen kan
          op e-mailadres van een bestaand account.
        </div>

        {/* Ledenlijst */}
        {membersQuery.isLoading ? (
          <div className="muted" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0' }}>
            <Loader2 size={13} className="spin" />
            Leden laden…
          </div>
        ) : membersQuery.isError ? (
          <div className="error-text" style={{ fontSize: 12.5, padding: '8px 0' }}>
            Kon leden niet laden: {asApiError(membersQuery.error).message}
          </div>
        ) : members.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5, padding: '8px 0' }}>
            Nog geen leden — voeg hieronder iemand toe.
          </div>
        ) : (
          <div>
            {members.map((member) => (
              <div
                key={member.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 12.5,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border-subtle)',
                    display: 'grid',
                    placeItems: 'center',
                    color: member.role === 'owner' ? 'var(--theme-accent)' : 'var(--theme-muted)',
                    flexShrink: 0,
                  }}
                >
                  {member.role === 'owner' ? <Crown size={13} /> : <Users size={13} />}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      color: 'var(--theme-text)',
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {member.email}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    Lid sinds {formatDate(member.createdAt)}
                  </div>
                </div>
                <span className={member.role === 'owner' ? 'pill pill-accent' : 'pill'}>
                  {ROLE_LABELS[member.role] ?? member.role}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 28, height: 28, flexShrink: 0, color: 'var(--danger)' }}
                  onClick={() => setConfirmRemove(member)}
                  disabled={removeMember.isPending}
                  aria-label={`Verwijder ${member.email}`}
                  title="Verwijderen"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Lid toevoegen */}
        <form
          onSubmit={(e) => void onAdd(e)}
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 10,
            flexWrap: 'wrap',
            marginTop: 12,
          }}
        >
          <div style={{ flex: 2, minWidth: 200 }}>
            <FormField label="E-mailadres">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="collega@voorbeeld.nl"
                disabled={addMember.isPending}
                style={{ marginBottom: 0 }}
              />
            </FormField>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <FormField label="Rol">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value === 'owner' ? 'owner' : 'staff')}
                disabled={addMember.isPending}
              >
                <option value="staff">Staff</option>
                <option value="owner">Owner</option>
              </select>
            </FormField>
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-icon-leading"
            disabled={addMember.isPending || !email.trim()}
            style={{ marginBottom: 14 }}
          >
            {addMember.isPending ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />}
            {addMember.isPending ? 'Toevoegen…' : 'Lid toevoegen'}
          </button>
        </form>
      </div>

      <ConfirmDialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove) void onRemove(confirmRemove);
        }}
        variant="danger"
        title="Lid verwijderen?"
        confirmLabel="Verwijderen"
        message={
          confirmRemove ? (
            <>
              <strong>{confirmRemove.email}</strong> verliest direct toegang tot deze shop.
              {confirmRemove.role === 'owner' && (
                <> Let op: de laatste owner kan niet verwijderd worden.</>
              )}
            </>
          ) : (
            ''
          )
        }
      />
    </section>
  );
}
