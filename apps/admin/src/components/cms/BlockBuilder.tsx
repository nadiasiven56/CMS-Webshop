/**
 * BlockBuilder — geordende block-editor voor de page-builder.
 *
 * Beheert een lokale `PageBlock[]` (controlled via value/onChange). Per block:
 *   - type-specifiek mini-formulier (hero/richtext/banner/product-grid/html)
 *   - omhoog/omlaag verplaatsen (sorteren)
 *   - dupliceren / verwijderen
 *   - inklappen/uitklappen
 * Blocks worden als vorm-vrije jsonb opgeslagen ({ type, data }); `id` is
 * client-only voor stabiele React-keys en wordt bij opslaan meegestuurd
 * (de backend bewaart de array 1-op-1).
 */
import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { FormField } from '@/components/ui/FormField';
import { BLOCK_META } from './pills';
import type { BlockType, PageBlock } from './types';

const BLOCK_ORDER: BlockType[] = ['hero', 'richtext', 'banner', 'product-grid', 'html'];

function newBlock(type: BlockType): PageBlock {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `blk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const defaults: Record<BlockType, Record<string, unknown>> = {
    hero: { heading: '', subheading: '', ctaLabel: '', ctaHref: '', image: '' },
    richtext: { html: '' },
    banner: { text: '', href: '', variant: 'info' },
    'product-grid': { heading: '', collection: '', limit: 8 },
    html: { html: '' },
  };
  return { id, type, data: { ...defaults[type] } };
}

interface Props {
  value: PageBlock[];
  onChange: (next: PageBlock[]) => void;
}

export function BlockBuilder({ value, onChange }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function patchBlock(id: string, data: Record<string, unknown>) {
    onChange(value.map((b) => (b.id === id ? { ...b, data: { ...b.data, ...data } } : b)));
  }
  function move(idx: number, dir: -1 | 1) {
    const next = [...value];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    onChange(next);
  }
  function remove(id: string) {
    onChange(value.filter((b) => b.id !== id));
  }
  function duplicate(idx: number) {
    const src = value[idx]!;
    const copy = { ...newBlock(src.type), data: { ...src.data } };
    const next = [...value];
    next.splice(idx + 1, 0, copy);
    onChange(next);
  }
  function add(type: BlockType) {
    onChange([...value, newBlock(type)]);
    setAddOpen(false);
  }

  return (
    <div>
      {value.length === 0 && (
        <div
          style={{
            padding: 16,
            textAlign: 'center',
            color: 'var(--theme-muted)',
            fontSize: 12.5,
            border: '1px dashed var(--theme-border-subtle, var(--border-subtle))',
            borderRadius: 8,
            marginBottom: 10,
          }}
        >
          Nog geen blocks. Voeg een sectie toe om de pagina op te bouwen.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {value.map((block, idx) => {
          const meta = BLOCK_META[block.type] ?? { label: block.type, emoji: '▫️', hint: '' };
          const isCollapsed = collapsed[block.id];
          return (
            <div
              key={block.id}
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: 10,
                background: 'var(--surface-2)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  background: 'var(--surface-3)',
                }}
              >
                <GripVertical size={14} style={{ color: 'var(--text-faint)' }} />
                <span aria-hidden="true">{meta.emoji}</span>
                <strong style={{ fontSize: 12.5 }}>{meta.label}</strong>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {summarize(block)}
                </span>
                <div style={{ flex: 1 }} />
                <IconBtn title="Omhoog" disabled={idx === 0} onClick={() => move(idx, -1)}>
                  <ChevronUp size={14} />
                </IconBtn>
                <IconBtn
                  title="Omlaag"
                  disabled={idx === value.length - 1}
                  onClick={() => move(idx, 1)}
                >
                  <ChevronDown size={14} />
                </IconBtn>
                <IconBtn title="Dupliceren" onClick={() => duplicate(idx)}>
                  <Copy size={13} />
                </IconBtn>
                <IconBtn title="Verwijderen" onClick={() => remove(block.id)}>
                  <Trash2 size={13} />
                </IconBtn>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '2px 8px' }}
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [block.id]: !c[block.id] }))
                  }
                >
                  {isCollapsed ? 'Bewerk' : 'Verberg'}
                </button>
              </div>

              {!isCollapsed && (
                <div style={{ padding: '12px 12px 4px' }}>
                  <BlockFields block={block} onPatch={(d) => patchBlock(block.id, d)} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, position: 'relative' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setAddOpen((o) => !o)}
        >
          <Plus size={13} /> Block toevoegen
        </button>
        {addOpen && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              marginTop: 8,
              padding: 8,
              border: '1px solid var(--border-default)',
              borderRadius: 10,
              background: 'var(--surface-2)',
            }}
          >
            {BLOCK_ORDER.map((t) => {
              const m = BLOCK_META[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => add(t)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 2,
                    padding: '8px 10px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    background: 'var(--surface-3)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--theme-text)' }}>
                    {m.emoji} {m.label}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--theme-muted)' }}>{m.hint}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── per-type velden ─────────────────────────────────────────────
function BlockFields({
  block,
  onPatch,
}: {
  block: PageBlock;
  onPatch: (d: Record<string, unknown>) => void;
}) {
  const d = block.data;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
  const num = (k: string, fallback: number) =>
    typeof d[k] === 'number' ? (d[k] as number) : fallback;

  switch (block.type) {
    case 'hero':
      return (
        <>
          <FormField label="Kop">
            <input value={str('heading')} onChange={(e) => onPatch({ heading: e.target.value })} />
          </FormField>
          <FormField label="Subtitel">
            <input
              value={str('subheading')}
              onChange={(e) => onPatch({ subheading: e.target.value })}
            />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <FormField label="CTA-tekst">
              <input value={str('ctaLabel')} onChange={(e) => onPatch({ ctaLabel: e.target.value })} />
            </FormField>
            <FormField label="CTA-link">
              <input value={str('ctaHref')} onChange={(e) => onPatch({ ctaHref: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Achtergrond-afbeelding (URL)">
            <input value={str('image')} onChange={(e) => onPatch({ image: e.target.value })} />
          </FormField>
        </>
      );
    case 'richtext':
      return (
        <FormField label="Tekst (HTML)">
          <textarea
            rows={5}
            value={str('html')}
            onChange={(e) => onPatch({ html: e.target.value })}
            style={{ resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }}
          />
        </FormField>
      );
    case 'banner':
      return (
        <>
          <FormField label="Tekst">
            <input value={str('text')} onChange={(e) => onPatch({ text: e.target.value })} />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8 }}>
            <FormField label="Link (optioneel)">
              <input value={str('href')} onChange={(e) => onPatch({ href: e.target.value })} />
            </FormField>
            <FormField label="Variant">
              <select value={str('variant') || 'info'} onChange={(e) => onPatch({ variant: e.target.value })}>
                <option value="info">Info</option>
                <option value="success">Succes</option>
                <option value="warning">Waarschuwing</option>
                <option value="promo">Promo</option>
              </select>
            </FormField>
          </div>
        </>
      );
    case 'product-grid':
      return (
        <>
          <FormField label="Kop (optioneel)">
            <input value={str('heading')} onChange={(e) => onPatch({ heading: e.target.value })} />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}>
            <FormField label="Collectie / tag">
              <input
                value={str('collection')}
                onChange={(e) => onPatch({ collection: e.target.value })}
                placeholder="bv. bestsellers"
              />
            </FormField>
            <FormField label="Aantal">
              <input
                type="number"
                min={1}
                max={48}
                value={num('limit', 8)}
                onChange={(e) => onPatch({ limit: Number(e.target.value) })}
              />
            </FormField>
          </div>
        </>
      );
    case 'html':
      return (
        <FormField label="Raw HTML">
          <textarea
            rows={5}
            value={str('html')}
            onChange={(e) => onPatch({ html: e.target.value })}
            style={{ resize: 'vertical', minHeight: 80, fontFamily: 'var(--font-mono, monospace)', fontSize: 12.5 }}
          />
        </FormField>
      );
    default:
      return null;
  }
}

function summarize(block: PageBlock): string {
  const d = block.data;
  const pick = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
  const text =
    pick('heading') || pick('text') || pick('html') || pick('collection') || '';
  if (!text) return '';
  const clean = text.replace(/<[^>]+>/g, '').trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      style={{ width: 26, height: 26, opacity: disabled ? 0.4 : 1 }}
    >
      {children}
    </button>
  );
}
