/**
 * /cms/menus — navigatie-menu's met geneste items-editor.
 *
 * Shop-scoped (useActiveShop). Lijst van menu's (location/name); click opent een
 * edit-drawer met menu-metadata + de items-editor (label/url/parent, sorteerbaar).
 * Items worden via de bulk-replace endpoint opgeslagen (PUT /cms/menus/:id/items).
 * Backend: GET/POST/PATCH/DELETE /api/cms/menus + PUT items.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Menu as MenuIcon, Plus, Trash2 } from 'lucide-react';
import { useActiveShop } from '@/lib/shop-context';
import { toast } from '@/lib/toast';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  useMenus,
  useMenu,
  useCreateMenu,
  useUpdateMenu,
  useDeleteMenu,
  useReplaceMenuItems,
} from '@/components/cms/api';
import {
  MenuItemsEditor,
  flattenItems,
  toBulkItems,
  type EditorItem,
} from '@/components/cms/MenuItemsEditor';
import type { CmsMenuDto } from '@/components/cms/types';

export const Route = createFileRoute('/_app/cms/menus')({
  component: CmsMenusPage,
});

const LOCATION_LABEL: Record<string, string> = {
  header: 'Header',
  footer: 'Footer',
  sidebar: 'Zijbalk',
};

function CmsMenusPage() {
  const { activeShopId, activeShop } = useActiveShop();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const query = useMenus(activeShopId);
  const menus = query.data?.items ?? [];

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Menu's</h1>
            <span className="count-badge">{menus.length}</span>
          </div>
          <p className="page-subtitle">
            Navigatie-structuur{activeShop ? ` voor ${activeShop.name}` : ''}.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setCreating(true)}
          disabled={!activeShopId}
        >
          <Plus size={15} strokeWidth={2.2} /> Nieuw menu
        </button>
      </header>

      {!activeShopId ? (
        <EmptyState icon={MenuIcon} title="Geen shop geselecteerd" description="Kies eerst een shop bovenaan." />
      ) : query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">Kon menu's niet laden. Probeer een refresh.</p>
        </div>
      ) : query.isLoading ? (
        <Skeleton height={240} />
      ) : menus.length === 0 ? (
        <EmptyState
          icon={MenuIcon}
          title="Nog geen menu's"
          description="Maak een header- of footer-menu om links te ordenen."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Nieuw menu
            </button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {menus.map((m) => (
            <button
              key={m.id}
              type="button"
              className="card"
              onClick={() => setEditingId(m.id)}
              style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'var(--theme-accent-subtle)',
                    color: 'var(--theme-accent)',
                  }}
                >
                  <MenuIcon size={16} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{m.name}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {LOCATION_LABEL[m.location] ?? m.location}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <MenuDrawer
        key={editingId ?? (creating ? 'new' : 'closed')}
        shopId={activeShopId}
        menuId={editingId}
        creating={creating}
        onClose={() => {
          setEditingId(null);
          setCreating(false);
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
function MenuDrawer({
  shopId,
  menuId,
  creating,
  onClose,
}: {
  shopId: string | null;
  menuId: string | null;
  creating: boolean;
  onClose: () => void;
}) {
  const open = creating || menuId != null;
  const isCreate = creating;

  const detail = useMenu(shopId, !isCreate ? menuId : null);
  const menu: CmsMenuDto | null = detail.data?.menu ?? null;

  const [name, setName] = useState('');
  const [location, setLocation] = useState('header');
  const [items, setItems] = useState<EditorItem[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const create = useCreateMenu(shopId);
  const update = useUpdateMenu(shopId);
  const del = useDeleteMenu(shopId);
  const replaceItems = useReplaceMenuItems(shopId);

  // reset bij open / load
  useEffect(() => {
    if (!open) return;
    if (isCreate) {
      setName('');
      setLocation('header');
      setItems([]);
    }
    setConfirmDelete(false);
  }, [open, isCreate]);

  useEffect(() => {
    if (menu) {
      setName(menu.name);
      setLocation(menu.location);
      setItems(flattenItems(menu.items));
    }
  }, [menu]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Naam is verplicht');
      return;
    }
    try {
      if (isCreate) {
        const created = await create.mutateAsync({ name: name.trim(), location });
        // items meteen wegschrijven indien aangemaakt vóór save
        if (items.length > 0) {
          await replaceItems.mutateAsync({ menuId: created.id, items: toBulkItems(items) });
        }
        toast.success(`Menu '${name}' aangemaakt`);
      } else if (menu) {
        if (menu.name !== name.trim() || menu.location !== location) {
          await update.mutateAsync({ id: menu.id, patch: { name: name.trim(), location } });
        }
        await replaceItems.mutateAsync({ menuId: menu.id, items: toBulkItems(items) });
        toast.success(`Menu '${name}' opgeslagen`);
      }
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Opslaan mislukt'));
    }
  }

  async function onDelete() {
    if (!menu) return;
    try {
      await del.mutateAsync(menu.id);
      toast.success(`Menu '${menu.name}' verwijderd`);
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Verwijderen mislukt'));
    }
  }

  const busy =
    create.isPending || update.isPending || replaceItems.isPending;

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        width={560}
        title={isCreate ? 'Nieuw menu' : menu?.name ?? 'Menu'}
        subtitle={isCreate ? 'Navigatie-menu aanmaken.' : LOCATION_LABEL[menu?.location ?? ''] ?? menu?.location}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuleer
            </button>
            {!isCreate && menu && (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} /> Verwijder
              </button>
            )}
            <button type="submit" form="menu-form" className="btn btn-primary" disabled={busy}>
              {isCreate ? 'Aanmaken' : 'Opslaan'}
            </button>
          </>
        }
      >
        {!isCreate && detail.isLoading ? (
          <Skeleton height={240} />
        ) : (
          <form id="menu-form" onSubmit={onSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 8 }}>
              <FormField label="Naam" required>
                <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </FormField>
              <FormField label="Locatie">
                <select value={location} onChange={(e) => setLocation(e.target.value)}>
                  <option value="header">Header</option>
                  <option value="footer">Footer</option>
                  <option value="sidebar">Zijbalk</option>
                </select>
              </FormField>
            </div>

            <h3
              style={{
                fontSize: 11,
                color: 'var(--theme-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                margin: '18px 0 8px',
              }}
            >
              Menu-items
            </h3>
            <MenuItemsEditor value={items} onChange={setItems} />
          </form>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDelete}
        title="Menu verwijderen?"
        message={
          <>
            <strong>{menu?.name}</strong> en alle items worden verwijderd.
          </>
        }
        confirmLabel="Verwijder"
      />
    </>
  );
}

function errMsg(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string; error?: string } } };
  return e?.response?.data?.message ?? e?.response?.data?.error ?? fallback;
}
