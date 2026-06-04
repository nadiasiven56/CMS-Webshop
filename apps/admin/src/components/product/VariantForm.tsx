import { useState } from 'react';
import type { VariantDto, VariantCreateInput, VariantUpdateInput } from './types';

interface RowProps {
  variant: VariantDto;
  onSave: (patch: VariantUpdateInput) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  saving?: boolean;
}

/**
 * VariantRow — inline-editable rij voor 1 variant.
 *
 * V1: editable via expand-toggle. Geen optimistic-update; bij save call je
 * de parent die in de query-cache kan invalidaten.
 */
export function VariantRow({ variant, onSave, onDelete, saving }: RowProps) {
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState(variant.sku);
  const [price, setPrice] = useState(variant.price);
  const [compareAt, setCompareAt] = useState(variant.compareAtPrice ?? '');
  const [costPrice, setCostPrice] = useState(variant.costPrice ?? '');
  const [barcode, setBarcode] = useState(variant.barcode ?? '');
  const [taxable, setTaxable] = useState(variant.taxable);
  const [taxClass, setTaxClass] = useState(variant.taxClass);
  const [active, setActive] = useState(variant.active);

  function handleSave() {
    const patch: VariantUpdateInput = {
      sku,
      price,
      compareAtPrice: compareAt.trim() === '' ? null : compareAt,
      costPrice: costPrice.trim() === '' ? null : costPrice,
      barcode: barcode.trim() === '' ? null : barcode,
      taxable,
      taxClass: taxClass as VariantUpdateInput['taxClass'],
      active,
    };
    void onSave(patch);
  }

  return (
    <div
      className="card"
      style={{
        padding: 12,
        borderColor: variant.active ? 'var(--theme-border)' : 'var(--theme-danger)',
        opacity: variant.active ? 1 : 0.7,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 120px 90px auto',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <div>
          <strong>{variant.sku}</strong>
          {!variant.active && (
            <span
              className="pill"
              style={{
                marginLeft: 8,
                color: 'var(--theme-danger)',
                borderColor: 'var(--theme-danger)',
              }}
            >
              Inactief
            </span>
          )}
        </div>
        <span className="muted" style={{ fontFamily: 'monospace' }}>
          € {Number(variant.price).toFixed(2)}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          {variant.taxClass}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Sluiten' : 'Bewerk'}
        </button>
      </div>

      {open && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--theme-border-subtle)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          <Field label="SKU">
            <input value={sku} onChange={(e) => setSku(e.target.value)} />
          </Field>
          <Field label="Prijs (excl)">
            <input value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Vergelijk-prijs">
            <input value={compareAt} onChange={(e) => setCompareAt(e.target.value)} />
          </Field>
          <Field label="Kostprijs">
            <input value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
          </Field>
          <Field label="Barcode (EAN/UPC)">
            <input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </Field>
          <Field label="BTW-klasse">
            <select value={taxClass} onChange={(e) => setTaxClass(e.target.value as typeof taxClass)}>
              <option value="standard">Standaard (21%)</option>
              <option value="reduced">Verlaagd (9%)</option>
              <option value="zero">Nul</option>
              <option value="exempt">Vrijgesteld</option>
            </select>
          </Field>
          <Field label="BTW-plichtig">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={taxable}
                onChange={(e) => setTaxable(e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span>Belastbaar</span>
            </label>
          </Field>
          <Field label="Actief">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span>Verkoopbaar</span>
            </label>
          </Field>

          <div
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              marginTop: 4,
            }}
          >
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void onDelete()}
              disabled={saving}
            >
              Variant deactiveren
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Bezig…' : 'Opslaan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

interface NewProps {
  onCreate: (input: VariantCreateInput) => Promise<void> | void;
  creating?: boolean;
}

export function NewVariantForm({ onCreate, creating }: NewProps) {
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('0.00');

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        + Variant toevoegen
      </button>
    );
  }
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>SKU</label>
          <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="UNIEK-SKU" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Prijs (excl)</label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setOpen(false)}
            disabled={creating}
          >
            Annuleer
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!sku || !price || creating}
            onClick={() => {
              void onCreate({ sku, price } as unknown as VariantCreateInput);
              setSku('');
              setPrice('0.00');
              setOpen(false);
            }}
          >
            {creating ? 'Bezig…' : 'Toevoegen'}
          </button>
        </div>
      </div>
    </div>
  );
}
