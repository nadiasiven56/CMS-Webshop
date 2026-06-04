/**
 * ShopDrawer — create/edit-drawer voor een shop.
 *
 * Eén component voor beide modi:
 *   - mode="create" → leeg formulier, POST /api/shops
 *   - mode="edit"   → voorgevuld vanuit `initial`, PATCH /api/shops/:id
 *
 * Velden: slug, name, domain, locale, currency, status, branding-kleuren
 * (primary/accent) + logoUrl, btw-config (priceIncludesVat, oss, defaultCountry).
 *
 * Voldoet aan de aanpasbaarheids-eis: ESC + backdrop sluit (via <Drawer>),
 * footer Annuleer/Opslaan, delete als secundaire actie (alleen in edit-modus).
 */
import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import type { ShopBranding, ShopDto, ShopStatus, ShopVatConfig } from './types';

export interface ShopFormValues {
  slug: string;
  name: string;
  domain: string;
  locale: string;
  currency: string;
  status: ShopStatus;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  priceIncludesVat: boolean;
  oss: boolean;
  defaultCountry: string;
}

const EMPTY: ShopFormValues = {
  slug: '',
  name: '',
  domain: '',
  locale: 'nl-NL',
  currency: 'EUR',
  status: 'draft',
  primaryColor: '',
  accentColor: '',
  logoUrl: '',
  priceIncludesVat: true,
  oss: false,
  defaultCountry: 'NL',
};

function fromShop(shop: ShopDto): ShopFormValues {
  const b = (shop.branding ?? {}) as ShopBranding;
  const v = (shop.vatConfig ?? {}) as ShopVatConfig;
  return {
    slug: shop.slug,
    name: shop.name,
    domain: shop.domain ?? '',
    locale: shop.locale ?? 'nl-NL',
    currency: shop.currency ?? 'EUR',
    status: (['active', 'draft', 'paused'].includes(shop.status)
      ? shop.status
      : 'draft') as ShopStatus,
    primaryColor: typeof b.primaryColor === 'string' ? b.primaryColor : '',
    accentColor: typeof b.accentColor === 'string' ? b.accentColor : '',
    logoUrl: typeof b.logoUrl === 'string' ? b.logoUrl : '',
    priceIncludesVat: v.priceIncludesVat ?? true,
    oss: v.oss ?? false,
    defaultCountry: typeof v.defaultCountry === 'string' ? v.defaultCountry : 'NL',
  };
}

/** Genereer een nette kebab-slug uit een naam. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Bouw het PATCH/POST-payload — alleen ingevulde optionele velden meesturen. */
export function valuesToPayload(v: ShopFormValues) {
  const branding: ShopBranding = {};
  if (v.primaryColor.trim()) branding.primaryColor = v.primaryColor.trim();
  if (v.accentColor.trim()) branding.accentColor = v.accentColor.trim();
  if (v.logoUrl.trim()) branding.logoUrl = v.logoUrl.trim();

  const vatConfig: ShopVatConfig = {
    priceIncludesVat: v.priceIncludesVat,
    oss: v.oss,
  };
  if (v.defaultCountry.trim()) {
    vatConfig.defaultCountry = v.defaultCountry.trim().toUpperCase();
  }

  return {
    slug: v.slug.trim(),
    name: v.name.trim(),
    domain: v.domain.trim() ? v.domain.trim() : null,
    locale: v.locale.trim() || 'nl-NL',
    currency: v.currency.trim().toUpperCase() || 'EUR',
    status: v.status,
    branding,
    vatConfig,
  };
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
};

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: ShopDto | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (payload: ReturnType<typeof valuesToPayload>) => void;
  /** Alleen in edit-modus: secundaire delete-actie. */
  onDelete?: () => void;
}

export function ShopDrawer({
  open,
  mode,
  initial,
  saving,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const [values, setValues] = useState<ShopFormValues>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ShopFormValues, string>>>({});

  // (Her)initialiseer telkens de drawer opent.
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initial) {
      setValues(fromShop(initial));
      setSlugTouched(true);
    } else {
      setValues(EMPTY);
      setSlugTouched(false);
    }
    setErrors({});
  }, [open, mode, initial]);

  function set<K extends keyof ShopFormValues>(key: K, val: ShopFormValues[K]) {
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      // Auto-slug uit naam zolang de gebruiker de slug niet handmatig raakte (create).
      if (key === 'name' && mode === 'create' && !slugTouched) {
        next.slug = slugify(String(val));
      }
      return next;
    });
  }

  function validate(): boolean {
    const e: Partial<Record<keyof ShopFormValues, string>> = {};
    if (!values.name.trim()) e.name = 'Naam is verplicht';
    if (!values.slug.trim()) e.slug = 'Slug is verplicht';
    else if (!SLUG_RE.test(values.slug.trim()))
      e.slug = 'Alleen kleine letters, cijfers en koppeltekens';
    if (values.currency.trim() && values.currency.trim().length !== 3)
      e.currency = '3-letterige ISO-code (bv. EUR)';
    if (values.defaultCountry.trim() && values.defaultCountry.trim().length !== 2)
      e.defaultCountry = '2-letterige landcode (bv. NL)';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    onSubmit(valuesToPayload(values));
  }

  const title = mode === 'create' ? 'Nieuwe shop' : 'Shop bewerken';
  const subtitle =
    mode === 'edit' && initial ? initial.name : 'Voeg een nieuwe winkel toe aan het platform';

  const footer = useMemo(
    () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        {mode === 'edit' && onDelete && (
          <button
            type="button"
            className="btn btn-ghost btn-icon-leading"
            onClick={onDelete}
            style={{ color: 'var(--danger)', marginRight: 'auto' }}
          >
            <Trash2 size={14} />
            Verwijderen
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
          Annuleer
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving ? 'Bezig…' : 'Opslaan'}
        </button>
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, onDelete, onClose, saving, values],
  );

  return (
    <Drawer open={open} onClose={onClose} title={title} subtitle={subtitle} width={460} footer={footer}>
      <FormField label="Naam" required error={errors.name}>
        <input
          style={INPUT_STYLE}
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Mijn winkel"
          autoFocus
        />
      </FormField>

      <FormField label="Slug" required error={errors.slug} hint="Uniek, gebruikt in URLs en API.">
        <input
          style={INPUT_STYLE}
          value={values.slug}
          onChange={(e) => {
            setSlugTouched(true);
            set('slug', e.target.value);
          }}
          placeholder="mijn-winkel"
        />
      </FormField>

      <FormField label="Domein" hint="Optioneel — bv. shop.voorbeeld.nl">
        <input
          style={INPUT_STYLE}
          value={values.domain}
          onChange={(e) => set('domain', e.target.value)}
          placeholder="shop.voorbeeld.nl"
        />
      </FormField>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormField label="Taal / locale">
          <input
            style={INPUT_STYLE}
            value={values.locale}
            onChange={(e) => set('locale', e.target.value)}
            placeholder="nl-NL"
          />
        </FormField>
        <FormField label="Valuta" error={errors.currency}>
          <input
            style={INPUT_STYLE}
            value={values.currency}
            onChange={(e) => set('currency', e.target.value.toUpperCase())}
            placeholder="EUR"
            maxLength={3}
          />
        </FormField>
      </div>

      <FormField label="Status">
        <select
          style={INPUT_STYLE}
          value={values.status}
          onChange={(e) => set('status', e.target.value as ShopStatus)}
        >
          <option value="draft">Concept</option>
          <option value="active">Actief</option>
          <option value="paused">Gepauzeerd</option>
        </select>
      </FormField>

      <div
        style={{
          marginTop: 4,
          marginBottom: 12,
          paddingTop: 14,
          borderTop: '1px solid var(--border-default)',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--theme-muted)',
        }}
      >
        Branding
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormField label="Primaire kleur">
          <ColorInput value={values.primaryColor} onChange={(v) => set('primaryColor', v)} />
        </FormField>
        <FormField label="Accentkleur">
          <ColorInput value={values.accentColor} onChange={(v) => set('accentColor', v)} />
        </FormField>
      </div>

      <FormField label="Logo-URL" hint="Optioneel — link naar logo-afbeelding.">
        <input
          style={INPUT_STYLE}
          value={values.logoUrl}
          onChange={(e) => set('logoUrl', e.target.value)}
          placeholder="https://…/logo.svg"
        />
      </FormField>

      <div
        style={{
          marginTop: 4,
          marginBottom: 12,
          paddingTop: 14,
          borderTop: '1px solid var(--border-default)',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--theme-muted)',
        }}
      >
        BTW-configuratie
      </div>

      <FormField label="Prijzen inclusief BTW" inline>
        <ToggleSwitch
          checked={values.priceIncludesVat}
          onChange={(v) => set('priceIncludesVat', v)}
        />
      </FormField>

      <FormField label="OSS (One Stop Shop)" inline hint="EU-grensoverschrijdende BTW-regeling.">
        <ToggleSwitch checked={values.oss} onChange={(v) => set('oss', v)} />
      </FormField>

      <FormField label="Standaard land" error={errors.defaultCountry} hint="2-letterige ISO-code.">
        <input
          style={{ ...INPUT_STYLE, maxWidth: 120 }}
          value={values.defaultCountry}
          onChange={(e) => set('defaultCountry', e.target.value.toUpperCase())}
          placeholder="NL"
          maxLength={2}
        />
      </FormField>
    </Drawer>
  );
}

/** Kleur-input: color-picker + hex-tekstveld naast elkaar. */
function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const valid = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        type="color"
        value={valid ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Kleurkiezer"
        style={{
          width: 34,
          height: 32,
          padding: 0,
          border: '1px solid var(--border-default)',
          borderRadius: 6,
          background: 'transparent',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#000000"
        style={{ ...INPUT_STYLE, flex: 1 }}
      />
    </div>
  );
}

/** Compacte toggle-switch (geen externe lib). */
function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 999,
        border: '1px solid var(--border-default)',
        background: checked ? 'var(--theme-accent)' : 'var(--theme-card2)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.15s',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
        }}
      />
    </button>
  );
}
