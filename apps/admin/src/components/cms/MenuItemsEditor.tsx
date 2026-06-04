/**
 * MenuItemsEditor — flat sorteerbare lijst van menu-items met 1 nesting-niveau.
 *
 * Werkt op een lokale `EditorItem[]` met client-refs; "Opslaan" stuurt de hele
 * set naar de bulk-replace endpoint (PUT /cms/menus/:id/items) met ref/parentRef
 * voor nesting. We houden het bewust simpel: roots + optionele parent (1 niveau),
 * wat de meeste shop-navigaties dekt. Server ondersteunt diepere nesting; deze
 * editor exposeert 1 niveau voor de UI.
 */
import { ChevronDown, ChevronUp, CornerDownRight, Plus, Trash2 } from 'lucide-react';
import { FormField } from '@/components/ui/FormField';
import type { BulkItem } from './api';
import type { CmsMenuItemDto } from './types';

export interface EditorItem {
  ref: string;
  label: string;
  url: string;
  /** ref van de parent (1 niveau diep) of null voor een root. */
  parentRef: string | null;
}

let counter = 0;
function freshRef(): string {
  counter += 1;
  return `i${Date.now().toString(36)}${counter}`;
}

export function newEditorItem(): EditorItem {
  return { ref: freshRef(), label: '', url: '', parentRef: null };
}

/** Geneste DTO-boom (van GET /cms/menus/:id) → platte EditorItem[]. */
export function flattenItems(tree: CmsMenuItemDto[] | undefined): EditorItem[] {
  const out: EditorItem[] = [];
  const walk = (nodes: CmsMenuItemDto[], parentRef: string | null) => {
    for (const n of nodes) {
      const ref = freshRef();
      out.push({ ref, label: n.label, url: n.url, parentRef });
      if (n.children && n.children.length > 0) walk(n.children, ref);
    }
  };
  walk(tree ?? [], null);
  return out;
}

/** EditorItem[] → bulk-payload (position uit volgorde, geldige parentRefs). */
export function toBulkItems(items: EditorItem[]): BulkItem[] {
  const known = new Set(items.map((i) => i.ref));
  return items.map((it, idx) => ({
    ref: it.ref,
    parentRef: it.parentRef && known.has(it.parentRef) ? it.parentRef : null,
    label: it.label.trim(),
    url: it.url.trim(),
    position: idx,
  }));
}

interface Props {
  value: EditorItem[];
  onChange: (next: EditorItem[]) => void;
}

export function MenuItemsEditor({ value, onChange }: Props) {
  function patch(ref: string, p: Partial<EditorItem>) {
    onChange(value.map((i) => (i.ref === ref ? { ...i, ...p } : i)));
  }
  function move(idx: number, dir: -1 | 1) {
    const next = [...value];
    const t = idx + dir;
    if (t < 0 || t >= next.length) return;
    [next[idx], next[t]] = [next[t]!, next[idx]!];
    onChange(next);
  }
  function remove(ref: string) {
    // verweesde kinderen worden weer root
    onChange(
      value
        .filter((i) => i.ref !== ref)
        .map((i) => (i.parentRef === ref ? { ...i, parentRef: null } : i)),
    );
  }
  function add() {
    onChange([...value, newEditorItem()]);
  }

  // Mogelijke parents = roots (items zonder parent) ≠ zichzelf.
  const roots = value.filter((i) => i.parentRef === null);

  return (
    <div>
      {value.length === 0 && (
        <div
          style={{
            padding: 14,
            textAlign: 'center',
            color: 'var(--theme-muted)',
            fontSize: 12.5,
            border: '1px dashed var(--border-subtle)',
            borderRadius: 8,
            marginBottom: 8,
          }}
        >
          Nog geen items. Voeg een link toe.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {value.map((it, idx) => {
          const isChild = it.parentRef !== null;
          const parentOptions = roots.filter((r) => r.ref !== it.ref);
          return (
            <div
              key={it.ref}
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: 8,
                background: 'var(--surface-2)',
                padding: 8,
                marginLeft: isChild ? 22 : 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {isChild && <CornerDownRight size={13} style={{ color: 'var(--text-faint)' }} />}
                <input
                  value={it.label}
                  onChange={(e) => patch(it.ref, { label: e.target.value })}
                  placeholder="Label"
                  style={{ flex: 1 }}
                />
                <input
                  value={it.url}
                  onChange={(e) => patch(it.ref, { url: e.target.value })}
                  placeholder="/pad of https://…"
                  style={{ flex: 1.4 }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  title="Omhoog"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  style={{ width: 26, height: 26, opacity: idx === 0 ? 0.4 : 1 }}
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Omlaag"
                  onClick={() => move(idx, 1)}
                  disabled={idx === value.length - 1}
                  style={{ width: 26, height: 26, opacity: idx === value.length - 1 ? 0.4 : 1 }}
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Verwijderen"
                  onClick={() => remove(it.ref)}
                  style={{ width: 26, height: 26 }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div style={{ marginTop: 6 }}>
                <FormField label="Onder (parent)" inline>
                  <select
                    value={it.parentRef ?? ''}
                    onChange={(e) => patch(it.ref, { parentRef: e.target.value || null })}
                  >
                    <option value="">— Hoofdniveau —</option>
                    {parentOptions.map((p) => (
                      <option key={p.ref} value={p.ref}>
                        {p.label || '(naamloos)'}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            </div>
          );
        })}
      </div>

      <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={add}>
        <Plus size={13} /> Item toevoegen
      </button>
    </div>
  );
}
