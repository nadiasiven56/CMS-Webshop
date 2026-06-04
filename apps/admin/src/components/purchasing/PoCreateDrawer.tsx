/**
 * PoCreateDrawer — maak een nieuwe purchase-order (concept) tegen de echte API.
 *
 * Flow:
 *   1. Kies leverancier (uit echte suppliers-lijst).
 *   2. Voeg regels toe via catalog-search (hergebruikt /stock-overview voor
 *      variant-gekoppelde items) of een handmatige SKU-regel.
 *   3. Per regel: aantal + inkoopprijs (excl). Optioneel BTW-% + verwachte datum.
 *   4. POST /purchasing/po → status 'draft'.
 *
 * Geld is string (numeric(12,4)); unitCost wordt als string meegestuurd.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { formatMoney } from '@/lib/format';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import {
  useCatalogSearch,
  useCreatePurchaseOrder,
  type PoItemInput,
  type Supplier,
} from './api';

interface DraftLine {
  key: string;
  variantId: string | null;
  sku: string;
  label: string;
  quantity: number;
  unitCost: string; // numeric string
}

interface Props {
  open: boolean;
  onClose: () => void;
  suppliers: Supplier[];
}

let lineCounter = 0;
function nextKey() {
  lineCounter += 1;
  return `line-${Date.now()}-${lineCounter}`;
}

export function PoCreateDrawer({ open, onClose, suppliers }: Props) {
  const createMut = useCreatePurchaseOrder();

  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [taxRate, setTaxRate] = useState(21);
  const [expectedDays, setExpectedDays] = useState(7);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);

  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setSupplierId('');
      setReference('');
      setTaxRate(21);
      setExpectedDays(7);
      setNotes('');
      setLines([]);
      setSearch('');
      setSearchDebounced('');
      setPickerOpen(false);
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const catalog = useCatalogSearch(searchDebounced, open && pickerOpen);

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.unitCost) || 0) * (l.quantity || 0), 0),
    [lines],
  );
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  function addCatalogLine(item: { variantId: string | null; sku: string | null; productTitle: string | null; variantSku: string | null }) {
    if (!item.variantId) {
      toast.error('Dit item heeft geen variant en kan niet besteld worden');
      return;
    }
    if (lines.some((l) => l.variantId === item.variantId)) {
      toast.info('Deze variant staat al op de PO');
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        key: nextKey(),
        variantId: item.variantId,
        sku: item.sku ?? item.variantSku ?? '',
        label: item.productTitle ?? item.variantSku ?? item.sku ?? 'Onbekend item',
        quantity: 1,
        unitCost: '0.0000',
      },
    ]);
    setSearch('');
    setPickerOpen(false);
  }

  function addManualLine() {
    setLines((prev) => [
      ...prev,
      { key: nextKey(), variantId: null, sku: '', label: 'Vrije regel', quantity: 1, unitCost: '0.0000' },
    ]);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supplierId) {
      toast.error('Kies een leverancier');
      return;
    }
    if (lines.length === 0) {
      toast.error('Voeg minstens 1 regel toe');
      return;
    }
    for (const l of lines) {
      if (l.quantity < 1) {
        toast.error(`Aantal moet ≥ 1 zijn (${l.label})`);
        return;
      }
      if (!l.variantId && !l.sku.trim()) {
        toast.error('Vrije regel heeft een SKU nodig');
        return;
      }
    }

    const items: PoItemInput[] = lines.map((l) => ({
      variantId: l.variantId,
      sku: l.sku.trim() || null,
      quantity: l.quantity,
      unitCost: normalizeMoney(l.unitCost),
    }));

    const expectedAt =
      expectedDays > 0
        ? new Date(Date.now() + expectedDays * 86_400_000).toISOString()
        : null;

    try {
      const po = await createMut.mutateAsync({
        supplierId,
        reference: reference.trim() || null,
        taxRate,
        expectedAt,
        notes: notes.trim() || null,
        items,
      });
      toast.success(`PO aangemaakt (concept) — ${formatMoney(Number(po.total))}`);
      onClose();
    } catch (err) {
      const e = asApiError(err);
      toast.error(e.message || 'PO aanmaken mislukt');
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={640}
      title="Nieuwe purchase-order"
      subtitle="Concept aanmaken — bestellen/ontvangen kan later."
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={createMut.isPending}>
            Annuleer
          </button>
          <button type="submit" form="po-create-form" className="btn btn-primary" disabled={createMut.isPending}>
            {createMut.isPending ? 'Bezig…' : 'Concept aanmaken'}
          </button>
        </>
      }
    >
      <form id="po-create-form" onSubmit={onSubmit}>
        <FormField label="Leverancier" required>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="">— Kies leverancier —</option>
            {suppliers.filter((s) => s.active).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.leadTimeDays}d lead-time
              </option>
            ))}
          </select>
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 1fr', gap: 8 }}>
          <FormField label="Referentie">
            <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="bv. INK-2026-001" />
          </FormField>
          <FormField label="BTW %">
            <input type="number" min={0} max={100} value={taxRate} onChange={(e) => setTaxRate(Math.max(0, Number(e.target.value)))} />
          </FormField>
          <FormField label="Verwacht over (dagen)">
            <input type="number" min={0} max={365} value={expectedDays} onChange={(e) => setExpectedDays(Math.max(0, Number(e.target.value)))} />
          </FormField>
        </div>

        {/* Regels */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0 8px' }}>
          <h3 style={sectionTitleStyle}>Regels ({lines.length})</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen((v) => !v)}>
              <Search size={12} /> Catalogus
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={addManualLine}>
              <Plus size={12} /> Vrije regel
            </button>
          </div>
        </div>

        {pickerOpen && (
          <div
            style={{
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              padding: 10,
              marginBottom: 12,
              background: 'var(--surface-2)',
            }}
          >
            <div className="search-input" style={{ marginBottom: 8 }}>
              <Search size={14} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Zoek product / SKU…"
                autoFocus
              />
            </div>
            {catalog.isLoading ? (
              <p className="muted" style={{ fontSize: 12, margin: 4 }}>Laden…</p>
            ) : (catalog.data ?? []).length === 0 ? (
              <p className="muted" style={{ fontSize: 12, margin: 4 }}>
                {searchDebounced ? 'Geen items gevonden.' : 'Typ om te zoeken.'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
                {(catalog.data ?? []).map((item) => (
                  <button
                    key={item.itemId}
                    type="button"
                    onClick={() => addCatalogLine(item)}
                    disabled={!item.variantId}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      gap: 8, padding: '6px 8px', borderRadius: 6, border: 'none',
                      background: 'transparent', textAlign: 'left', cursor: item.variantId ? 'pointer' : 'not-allowed',
                      color: item.variantId ? 'var(--theme-text)' : 'var(--theme-muted)', fontSize: 12.5,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.productTitle ?? item.variantSku ?? item.sku}
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--theme-muted)', flexShrink: 0 }}>{item.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {lines.length === 0 ? (
          <div
            style={{
              padding: '16px 12px', textAlign: 'center', fontSize: 12.5,
              color: 'var(--theme-muted)', border: '1px dashed var(--border-default)',
              borderRadius: 8, marginBottom: 12,
            }}
          >
            Nog geen regels. Voeg items toe uit de catalogus of een vrije regel.
          </div>
        ) : (
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ width: 70, textAlign: 'right' }}>Aantal</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Prijs/st</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Regel</th>
                  <th style={{ width: 32 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      {l.variantId ? (
                        <>
                          <div style={{ fontSize: 12.5 }}>{l.label}</div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--theme-muted)' }}>{l.sku}</div>
                        </>
                      ) : (
                        <input
                          type="text"
                          value={l.sku}
                          onChange={(e) => updateLine(l.key, { sku: e.target.value })}
                          placeholder="SKU"
                          style={{ width: '100%', fontSize: 12, padding: '4px 8px' }}
                        />
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: Math.max(1, Number(e.target.value)) })}
                        style={{ width: 60, fontSize: 12, padding: '4px 6px', textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={l.unitCost}
                        onChange={(e) => updateLine(l.key, { unitCost: e.target.value })}
                        style={{ width: 96, fontSize: 12, padding: '4px 6px', textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>
                      {formatMoney((Number(l.unitCost) || 0) * l.quantity)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 26, height: 26 }}
                        onClick={() => removeLine(l.key)}
                        aria-label="Regel verwijderen"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <FormField label="Notities">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ resize: 'vertical', minHeight: 48 }} />
        </FormField>

        <div style={totalsBoxStyle}>
          <Row label="Subtotaal (excl)" value={formatMoney(subtotal)} />
          <Row label={`BTW (${taxRate}%)`} value={formatMoney(tax)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
            <span>Totaal (incl)</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(total)}</span>
          </div>
        </div>
      </form>
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
      <span style={{ color: 'var(--theme-muted)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

/** "45" / "45.5" → "45.0000" (numeric(12,4)-compatibel, max 4 decimalen). */
function normalizeMoney(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.0000';
  return n.toFixed(4);
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--theme-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  margin: 0,
  fontWeight: 600,
};

const totalsBoxStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: 'var(--surface-2)',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  marginTop: 4,
};
